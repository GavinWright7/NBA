/**
 * Instagram Engagement Scraper (Selenium + Chrome)
 *
 * How to run:
 *   npx prisma generate   # after schema changes
 *   npx prisma db push    # apply schema (posts, igEngagementLastCheckedAt, igEngagementStatus)
 *   npm run ig:engagement -- --headless --limit=25
 *   npm run ig:engagement -- --headless --limit=50 --startFrom="Stephen Curry"
 *   npm run ig:engagement -- --force --only-missing
 *
 * CLI flags:
 *   --headless          Run Chrome headless
 *   --limit=N           Max players to process (default: no limit)
 *   --startFrom="Name"  Start from first player whose name >= Name (lexicographic)
 *   --force             Ignore 7-day / status check and re-scrape
 *   --only-missing      Only players missing engagementRate or avgLikes/avgComments
 *
 * Failures are appended to data/ig_engagement_failed.csv (name, instagram, reason).
 */

require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require("path");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DEFAULT_N_POSTS = 12;
const MIN_DELAY_MS = 3000;
const MAX_DELAY_MS = 8000;
const SKIP_IF_OK_DAYS = 7;
const FAILED_CSV = path.join(__dirname, "..", "data", "ig_engagement_failed.csv");

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { headless: false, limit: null, startFrom: null, force: false, onlyMissing: false };
  for (const a of args) {
    if (a === "--headless") out.headless = true;
    else if (a === "--force") out.force = true;
    else if (a === "--only-missing") out.onlyMissing = true;
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10) || null;
    else if (a.startsWith("--startFrom=")) out.startFrom = a.slice(12).replace(/^["']|["']$/g, "").trim() || null;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function parseCount(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "").replace(/\s/g, "");
  if (!t.length) return null;
  const match = t.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  let n = parseFloat(match[1], 10);
  if (Number.isNaN(n)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

function createDriver(headless) {
  const options = new chrome.Options();
  if (headless) options.addArguments("--headless=new");
  options.addArguments(
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  return new Builder().forBrowser("chrome").setChromeOptions(options).build();
}

/**
 * DuckDuckGo search: "<player name> instagram site:instagram.com"
 * Returns first valid profile URL (not /p/, /reel/, /tv/, /explore/, etc.)
 */
async function ddgSearchProfileUrl(driver, playerName, handle) {
  const query = `"${playerName}" instagram site:instagram.com`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  await driver.get(url);
  await randomDelay();
  const html = await driver.getPageSource();
  const profileRe = /href="(https?:\/\/(?:www\.)?instagram\.com\/([^/"?#]+)(?:\/)?)"/gi;
  const invalidPaths = /^\s*(p|reel|tv|explore|stories|accounts|direct|reels)\s*$/i;
  const seen = new Set();
  let match;
  while ((match = profileRe.exec(html)) !== null) {
    let u = match[1].replace(/\\u0026/g, "&");
    const username = (match[2] || "").trim();
    if (invalidPaths.test(username)) continue;
    if (!/^[\w.]+$/.test(username)) continue;
    if (seen.has(username.toLowerCase())) continue;
    seen.add(username.toLowerCase());
    if (!u.startsWith("http")) u = `https://www.instagram.com/${username}/`;
    return u;
  }
  const fallback = `https://www.instagram.com/${(handle || "").replace(/^@/, "").trim()}/`;
  return fallback;
}

/**
 * Extract numbers from Instagram profile page source (shared data JSON).
 */
function extractFromPageSource(pageSource) {
  const out = { followers: null, totalPosts: null };
  const followRe = /"edge_followed_by":\s*\{\s*"count":\s*(\d+)/;
  const mediaRe = /"edge_owner_to_timeline_media":\s*\{\s*"count":\s*(\d+)/;
  const m1 = pageSource.match(followRe);
  const m2 = pageSource.match(mediaRe);
  if (m1) out.followers = parseInt(m1[1], 10);
  if (m2) out.totalPosts = parseInt(m2[1], 10);
  return out;
}

/**
 * Parse likes/comments from modal text (handles "X likes", "X like", "View all X comments", K/M).
 */
function parseLikesFromText(text) {
  if (!text || typeof text !== "string") return null;
  const likeMatch = text.match(/([\d.,]+\s*[KMB]?)\s*likes?/i) || text.match(/([\d,]+)\s*likes?/i);
  if (likeMatch) return parseCount(likeMatch[1]);
  const numOnly = text.replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (numOnly) return parseCount(numOnly[0]);
  return null;
}

function parseCommentsFromText(text) {
  if (!text || typeof text !== "string") return null;
  const viewAll = text.match(/View all ([\d,]+\s*[KMB]?)\s*comments?/i) || text.match(/([\d,]+)\s*comments?/i);
  if (viewAll) return parseCount(viewAll[1]);
  return null;
}

/**
 * Scrape profile: stats from page source, then open first N posts and get likes/comments from modal.
 */
async function scrapeProfileStatsAndRecentPosts(driver, profileUrl, N = DEFAULT_N_POSTS) {
  const result = {
    followers: null,
    totalPosts: null,
    avgLikes: null,
    avgComments: null,
    engagementRate: null,
    status: "ok",
  };
  await driver.get(profileUrl);
  await randomDelay();

  const pageSource = await driver.getPageSource();
  if (/login|sign up|log in/i.test(pageSource) && /instagram/i.test(pageSource)) {
    result.status = "login_wall";
    return result;
  }
  if (/sorry.*page.*available|page not found|404/i.test(pageSource)) {
    result.status = "page_not_available";
    return result;
  }
  if (/private account|this account is private/i.test(pageSource)) {
    result.status = "private";
    return result;
  }
  if (/rate limit|too many requests|try again later/i.test(pageSource)) {
    result.status = "rate_limit";
    return result;
  }

  const fromJson = extractFromPageSource(pageSource);
  result.followers = fromJson.followers;
  result.totalPosts = fromJson.totalPosts;

  const likesList = [];
  const commentsList = [];

  try {
    const postLinks = await driver.findElements(
      By.css('a[href*="/p/"], a[href*="/reel/"]')
    );
    const toOpen = postLinks.slice(0, N);
    for (let i = 0; i < toOpen.length; i++) {
      try {
        const links = await driver.findElements(
          By.css('a[href*="/p/"], a[href*="/reel/"]')
        );
        if (i >= links.length) break;
        await driver.executeScript("arguments[0].scrollIntoView({block:'center'});", links[i]);
        await randomDelay();
        await links[i].click();
        await sleep(1500);
        let modalText = "";
        try {
          const modal = await driver.wait(
            until.elementLocated(By.css('article section, [role="dialog"] section, article')),
            8000
          );
          modalText = await modal.getText();
        } catch (_) {
          const body = await driver.findElement(By.css("body"));
          modalText = await body.getText();
        }
        const likes = parseLikesFromText(modalText);
        const comments = parseCommentsFromText(modalText);
        if (likes != null) likesList.push(likes);
        if (comments != null) commentsList.push(comments);
      } catch (_) {}
      try {
        const closeBtn = await driver.findElement(
          By.css('svg[aria-label="Close"], [aria-label="Close"], button[aria-label="Close"]')
        );
        await closeBtn.click();
      } catch (_) {
        await driver.executeScript("window.history.back();");
      }
      await randomDelay();
    }
  } catch (_) {}

  if (likesList.length) {
    result.avgLikes = Math.round(likesList.reduce((a, b) => a + b, 0) / likesList.length);
  }
  if (commentsList.length) {
    result.avgComments = Math.round(commentsList.reduce((a, b) => a + b, 0) / commentsList.length);
  }
  if (result.followers != null && result.followers > 0 && (result.avgLikes != null || result.avgComments != null)) {
    const totalEng = (result.avgLikes || 0) + (result.avgComments || 0);
    result.engagementRate = Math.round((totalEng / result.followers) * 10000) / 100;
  }
  return result;
}

function appendFailedCsv(name, instagram, reason) {
  const dir = path.dirname(FAILED_CSV);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const exists = fs.existsSync(FAILED_CSV);
  const line = [name, instagram, reason].map((f) => `"${String(f).replace(/"/g, '""')}"`).join(",") + "\n";
  if (!exists) {
    fs.writeFileSync(FAILED_CSV, "name,instagram,reason\n" + line, "utf-8");
  } else {
    fs.appendFileSync(FAILED_CSV, line, "utf-8");
  }
}

async function main() {
  const args = parseArgs();
  let players = await prisma.player.findMany({
    where: {
      instagram: { not: null, not: "" },
    },
    select: {
      id: true,
      name: true,
      instagram: true,
      followers: true,
      posts: true,
      avgLikes: true,
      avgComments: true,
      engagementRate: true,
      igEngagementLastCheckedAt: true,
      igEngagementStatus: true,
    },
    orderBy: { name: "asc" },
  });

  if (args.startFrom) {
    const idx = players.findIndex((p) => p.name >= args.startFrom);
    if (idx >= 0) players = players.slice(idx);
  }
  if (args.limit != null && args.limit > 0) {
    players = players.slice(0, args.limit);
  }
  if (!args.force) {
    const cutoff = new Date(Date.now() - SKIP_IF_OK_DAYS * 24 * 60 * 60 * 1000);
    players = players.filter(
      (p) =>
        p.igEngagementLastCheckedAt == null ||
        p.igEngagementLastCheckedAt < cutoff ||
        (p.igEngagementStatus && p.igEngagementStatus !== "ok")
    );
  }
  if (args.onlyMissing) {
    players = players.filter(
      (p) =>
        p.engagementRate == null ||
        p.avgLikes == null ||
        p.avgComments == null
    );
  }

  console.log("Players to process:", players.length);
  const driver = createDriver(args.headless);
  try {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const handle = (p.instagram || "").trim().replace(/^@/, "");
      let profileUrl = `https://www.instagram.com/${handle}/`;
      let status = "ok";
      let followers = p.followers;
      let totalPosts = p.posts;
      let avgLikes = p.avgLikes;
      let avgComments = p.avgComments;
      let engagementRate = p.engagementRate;
      try {
        const found = await ddgSearchProfileUrl(driver, p.name, handle);
        if (found) profileUrl = found;
        const scraped = await scrapeProfileStatsAndRecentPosts(driver, profileUrl, DEFAULT_N_POSTS);
        status = scraped.status;
        if (scraped.followers != null) followers = scraped.followers;
        if (scraped.totalPosts != null) totalPosts = scraped.totalPosts;
        if (scraped.avgLikes != null) avgLikes = scraped.avgLikes;
        if (scraped.avgComments != null) avgComments = scraped.avgComments;
        if (scraped.engagementRate != null) engagementRate = scraped.engagementRate;
      } catch (err) {
        status = "error";
        appendFailedCsv(p.name, handle, err?.message || String(err));
        console.log(
          p.name,
          "error",
          followers ?? "-",
          totalPosts ?? "-",
          avgLikes ?? "-",
          avgComments ?? "-",
          engagementRate ?? "-"
        );
        await prisma.player.update({
          where: { id: p.id },
          data: {
            igEngagementLastCheckedAt: new Date(),
            igEngagementStatus: "error",
          },
        });
        await randomDelay();
        continue;
      }
      if (status !== "ok") {
        appendFailedCsv(p.name, handle, status);
      }
      console.log(
        p.name,
        status,
        followers ?? "-",
        totalPosts ?? "-",
        avgLikes ?? "-",
        avgComments ?? "-",
        engagementRate ?? "-"
      );
      await prisma.player.update({
        where: { id: p.id },
        data: {
          ...(followers != null && { followers }),
          ...(totalPosts != null && { posts: totalPosts }),
          ...(avgLikes != null && { avgLikes }),
          ...(avgComments != null && { avgComments }),
          engagementRate: engagementRate != null ? engagementRate : null,
          igEngagementLastCheckedAt: new Date(),
          igEngagementStatus: status,
        },
      });
      await randomDelay();
    }
  } finally {
    await driver.quit();
  }
  console.log("Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
