/**
 * Instagram stats via SocialBlade (Selenium + Chrome).
 * Uses canonical URL: https://socialblade.com/instagram/user/<handle>
 * DOM-based scrape of header stats: Followers, Following, Media Count, Engagement Rate, Average Likes, Average Comments.
 *
 * How to run:
 *   npx prisma generate
 *   npx prisma db push
 *   npm run ig:stats:socialblade -- --headless --limit=10
 *   npm run ig:stats:socialblade -- --headless --limit=50 --startFrom="Stephen Curry"
 *   npm run ig:stats:socialblade -- --force --only-missing
 *
 * CLI: --headless, --limit=N, --startFrom="Name", --force, --only-missing
 * Failures: data/ig_socialblade_failed.csv (name, instagram, reason, url, missing_stats)
 */

require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Builder, By, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 8000;
const SKIP_IF_OK_DAYS = 7;
const MAX_RETRIES = 2;
const FAILED_CSV = path.join(__dirname, "..", "data", "ig_socialblade_failed.csv");
const DEBUG_DIR = path.join(__dirname, "..", "data", "debug");
const CHROME_PROFILE_DIR = path.join(__dirname, "..", "data", "chrome-profile");
const STAT_LABELS = [
  "Followers",
  "Following",
  "Media Count",
  "Uploads",
  "Engagement Rate",
  "Average Likes",
  "Average Comments",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { headless: false, limit: null, startFrom: null, force: false, onlyMissing: false };
  for (const a of args) {
    if (a === "--headless") out.headless = true; // default: run non-headless to reduce Cloudflare blocks
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

/** Wait for user to press Enter (e.g. after solving CAPTCHA). */
function waitForEnter(promptMessage) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(promptMessage, () => {
      rl.close();
      resolve();
    });
  });
}

/** Remove commas, parse integer. */
function parseIntClean(s) {
  if (s == null || typeof s !== "string") return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t.length) return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

/** Remove commas, parse float. */
function parseFloatClean(s) {
  if (s == null || typeof s !== "string") return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t.length) return null;
  const n = parseFloat(t, 10);
  return Number.isNaN(n) ? null : n;
}

/** "8.25%" or "8.25" -> 8.25 */
function parsePercent(s) {
  if (s == null || typeof s !== "string") return null;
  const t = String(s).trim().replace(/%/g, "").replace(/,/g, "");
  if (!t.length) return null;
  const n = parseFloat(t, 10);
  return Number.isNaN(n) ? null : n;
}

/** Parse number that may have K/M/B. */
function parseCountKmb(s) {
  if (s == null || typeof s !== "string") return null;
  const t = String(s).trim().replace(/,/g, "").replace(/\s/g, "");
  if (!t.length || t === "---" || /^[-–—]+$/.test(t)) return null;
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

async function createDriver(headless) {
  console.log("[driver] launching Chrome...");
  if (!fs.existsSync(CHROME_PROFILE_DIR)) {
    fs.mkdirSync(CHROME_PROFILE_DIR, { recursive: true });
  }
  const options = new chrome.Options();
  if (headless) options.addArguments("--headless=new");
  options.addArguments(
    `--user-data-dir=${CHROME_PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--window-size=1280,800",
    "--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
  );
  options.excludeSwitches(["enable-automation"]);
  options.addArguments("--disable-blink-features=AutomationControlled");
  const driver = new Builder().forBrowser("chrome").setChromeOptions(options).build();
  await driver.manage().window().setRect({ width: 1280, height: 800 });
  return driver;
}

/** Stricter: only Cloudflare/verify/captcha indicators in title or body. Do NOT mark blocked for unrelated "blocked" text. */
function isBlocked(titleAndBody) {
  if (!titleAndBody || typeof titleAndBody !== "string") return false;
  const lower = titleAndBody.toLowerCase();
  const indicators = [
    "just a moment",
    "verify you are human",
    "checking your browser",
    "access denied",
    "attention required",
    "cloudflare",
    "cf-browser-verification",
    "captcha",
    "enable javascript and cookies",
    "ddos protection by cloudflare",
    "ray id",
    "performance & security by cloudflare",
  ];
  return indicators.some((phrase) => lower.includes(phrase));
}

/**
 * Log in to SocialBlade once at startup. Required to view Instagram stats.
 * Uses SOCIALBLADE_EMAIL and SOCIALBLADE_PASSWORD from env. Throws on failure.
 * Uses existing Chrome profile so session is reused; checks for existing session first.
 */
async function loginToSocialBlade(driver) {
  try {
    await driver.get("https://socialblade.com");
  } catch (err) {
    const currentUrl = await driver.getCurrentUrl().catch(() => "(failed to get URL)");
    console.error("[login] navigation failed. Full error:", err?.message ?? err);
    console.error("[login] current URL:", currentUrl);
    throw new Error(`SocialBlade navigation failed: ${err?.message ?? err}. URL: ${currentUrl}`);
  }
  await sleep(2000);

  const loggedInSelectors = ['[href*="logout"]', '[href*="dashboard"]', '[href*="/user/"]'];
  for (const sel of loggedInSelectors) {
    try {
      await driver.findElement(By.css(sel));
      console.log("✅ Already logged in via existing Chrome session");
      await sleep(1500);
      return;
    } catch (_) {}
  }

  const email = process.env.SOCIALBLADE_EMAIL;
  const password = process.env.SOCIALBLADE_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "SocialBlade login requires SOCIALBLADE_EMAIL and SOCIALBLADE_PASSWORD in .env. Add them and try again."
    );
  }

  try {
    await driver.get("https://socialblade.com/login");
  } catch (err) {
    const currentUrl = await driver.getCurrentUrl().catch(() => "(failed to get URL)");
    console.error("[login] navigation to /login failed. Full error:", err?.message ?? err);
    console.error("[login] current URL:", currentUrl);
    throw new Error(`SocialBlade login navigation failed: ${err?.message ?? err}. URL: ${currentUrl}`);
  }
  await sleep(2000);

  const emailSelectors = [
    'input[name="email"]',
    'input[type="email"]',
    'input[placeholder*="mail" i]',
    'input[placeholder*="email" i]',
  ];
  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
  ];
  let emailEl = null;
  let passwordEl = null;
  for (const sel of emailSelectors) {
    try {
      emailEl = await driver.findElement(By.css(sel));
      if (emailEl) break;
    } catch (_) {}
  }
  for (const sel of passwordSelectors) {
    try {
      passwordEl = await driver.findElement(By.css(sel));
      if (passwordEl) break;
    } catch (_) {}
  }
  if (!emailEl || !passwordEl) {
    throw new Error(
      "SocialBlade login: could not find email or password field on https://socialblade.com/login"
    );
  }

  await emailEl.clear();
  await emailEl.sendKeys(email);
  await passwordEl.clear();
  await passwordEl.sendKeys(password);

  const loginFormStillVisible = await (async () => {
    try {
      await driver.findElement(By.css('input[type="password"]'));
      const url = await driver.getCurrentUrl();
      return /\/login\/?(\?|$)/i.test(url) || url.includes("/login");
    } catch (_) {
      return false;
    }
  })();
  if (loginFormStillVisible) {
    await waitForEnter(
      "\n⏸  Complete the Cloudflare CAPTCHA in the browser then press Enter...\n"
    );
  }

  let submitted = false;
  const submitCss = ['button[type="submit"]', 'input[type="submit"]', 'form button'];
  for (const sel of submitCss) {
    try {
      const btn = await driver.findElement(By.css(sel));
      if (btn) {
        await btn.click();
        submitted = true;
        break;
      }
    } catch (_) {}
  }
  if (!submitted) {
    try {
      const submitByXpath = await driver.findElement(
        By.xpath("//button[contains(., 'Log in') or contains(., 'Login') or contains(., 'Sign in')]")
      );
      await submitByXpath.click();
      submitted = true;
    } catch (_) {}
  }
  if (!submitted) {
    throw new Error(
      "SocialBlade login: could not find submit button on login form"
    );
  }

  await sleep(3000);
  const currentUrl = await driver.getCurrentUrl();
  const stillOnLogin = /\/login\/?(\?|$)/i.test(currentUrl) || currentUrl.includes("/login");
  if (stillOnLogin) {
    const bodyText = await driver.executeScript(
      "return document.body ? document.body.innerText : '';"
    );
    const snippet = String(bodyText).slice(0, 500);
    throw new Error(
      `SocialBlade login failed: still on login page (${currentUrl}). Page snippet: ${snippet}`
    );
  }

  console.log("✅ Login successful — session saved to chrome-profile. Future runs will skip this step.");

  try {
    await driver.wait(
      until.elementLocated(
        By.css('[class*="avatar"], [class*="user"], [class*="account"], [class*="profile"], [href*="/dashboard"], [href*="/user"]')
      ),
      10000
    );
  } catch (_) {
  }
  await sleep(2000 + Math.random() * 1000);
}

/** Save screenshot and HTML when status !== "ok" for debugging. */
async function saveDiagnostics(driver, handle, status) {
  const safeHandle = (handle || "unknown").replace(/[^a-z0-9_-]/gi, "_").slice(0, 64);
  const prefix = path.join(DEBUG_DIR, `socialblade_${safeHandle}_${status}`);
  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });
  try {
    const currentUrl = await driver.getCurrentUrl();
    console.log("[debug] current URL:", currentUrl);
    const pngPath = `${prefix}.png`;
    const htmlPath = `${prefix}.html`;
    const pngBase64 = await driver.takeScreenshot();
    fs.writeFileSync(pngPath, Buffer.from(pngBase64, "base64"));
    const html = await driver.getPageSource();
    fs.writeFileSync(htmlPath, html, "utf-8");
    console.log("[debug] saved:", pngPath, htmlPath);
  } catch (e) {
    console.error("[debug] save failed:", e?.message || e);
  }
}

/** Dismiss cookie/consent banner if present. */
async function dismissCookieBanner(driver) {
  try {
    const selectors = [
      'button[aria-label="Accept"]',
      'a[href*="accept"]',
      'button:contains("Accept")',
      '.cookie-accept',
      '[data-testid="cookie-accept"]',
      '//button[contains(., "Accept")]',
      '//a[contains(., "Accept")]',
      '//button[contains(., "Got it")]',
      '//*[contains(., "cookie")]//button',
    ];
    for (const sel of selectors) {
      try {
        const el = sel.startsWith("//")
          ? await driver.findElement(By.xpath(sel))
          : await driver.findElement(By.css(sel));
        if (el) {
          await el.click();
          await sleep(500);
          return;
        }
      } catch (_) {}
    }
  } catch (_) {}
}

/**
 * DOM-based extraction: find elements containing each label, get container text, parse value.
 * Returns { followers, following, posts, engagementRate, avgLikes, avgComments, missing }.
 */
async function scrapeSocialBladeStatsDom(driver) {
  const out = {
    followers: null,
    following: null,
    posts: null,
    engagementRate: null,
    avgLikes: null,
    avgComments: null,
    missing: [],
  };
  const labelToKey = {
    "Followers": "followers",
    "Following": "following",
    "Media Count": "posts",
    "Uploads": "posts",
    "Engagement Rate": "engagementRate",
    "Average Likes": "avgLikes",
    "Average Comments": "avgComments",
  };
  const labelToParser = {
    "Followers": (t) => parseCountKmb(t) ?? parseIntClean(t),
    "Following": (t) => parseCountKmb(t) ?? parseIntClean(t),
    "Media Count": (t) => parseCountKmb(t) ?? parseIntClean(t),
    "Uploads": (t) => parseCountKmb(t) ?? parseIntClean(t),
    "Engagement Rate": (t) => parsePercent(t),
    "Average Likes": (t) => parseFloatClean(t) ?? parseCountKmb(t),
    "Average Comments": (t) => parseFloatClean(t) ?? parseCountKmb(t),
  };

  try {
    await driver.wait(
      until.elementLocated(By.xpath("//*[contains(., 'Followers') or contains(., 'Media Count') or contains(., 'Engagement')]")),
      20000
    );
    await sleep(2000);
  } catch (_) {
    out.missing = STAT_LABELS.slice();
    return out;
  }

  for (const label of STAT_LABELS) {
    const key = labelToKey[label];
    if (key === "posts" && out.posts != null) continue;
    try {
      const el = await driver.findElement(
        By.xpath(`//*[contains(normalize-space(.), '${label.replace(/'/g, "''")}')]`)
      );
      const container = await el.findElement(By.xpath("./ancestor::*[self::div or self::td or self::li or self::span][1]"));
      let blockText = await container.getText();
      if (!blockText || blockText.length > 200) {
        try {
          const parent = await container.findElement(By.xpath(".."));
          blockText = await parent.getText();
        } catch (_) {}
      }
      if (!blockText) {
        out.missing.push(label);
        continue;
      }
      const parser = labelToParser[label];
      let val = parser(blockText);
      if (val == null && blockText.includes(label)) {
        const rest = blockText.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
        const numMatch = rest.match(/[\d,.]+%?|\d[\d,.]*(?:[KMB])?/);
        if (numMatch) val = parser(numMatch[0]);
      }
      if (val != null) out[key] = val;
      else out.missing.push(label);
    } catch (_) {
      out.missing.push(label);
    }
  }

  return out;
}

function appendFailedCsv(name, instagram, reason, url, missingStats) {
  const dir = path.dirname(FAILED_CSV);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const exists = fs.existsSync(FAILED_CSV);
  const missingStr = Array.isArray(missingStats) ? missingStats.join("; ") : "";
  const row = [name, instagram, reason, url || "", missingStr]
    .map((f) => `"${String(f).replace(/"/g, '""')}"`)
    .join(",") + "\n";
  if (!exists) fs.writeFileSync(FAILED_CSV, "name,instagram,reason,url,missing_stats\n" + row, "utf-8");
  else fs.appendFileSync(FAILED_CSV, row, "utf-8");
}

async function processOnePlayer(driver, p) {
  const handle = (p.instagram || "").trim().replace(/^@/, "").toLowerCase();
  if (!handle) {
    return { status: "error", url: null, scraped: null, error: "empty_handle" };
  }
  const url = `https://socialblade.com/instagram/user/${encodeURIComponent(handle)}`;
  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await driver.get(url);
      await sleep(3000);
      let currentUrl = await driver.getCurrentUrl();
      if (currentUrl.includes("/login")) {
        console.log("[auth] Session expired, re-logging in...");
        await loginToSocialBlade(driver);
        await driver.get(url);
        await sleep(3000);
      }
      const titleAndBody = await driver.executeScript(
        "return (document.title || '') + ' ' + (document.body ? document.body.innerText : '');"
      );
      const titleAndBodyStr = String(titleAndBody || "");
      if (isBlocked(titleAndBodyStr)) {
        console.log("[blocked] first 300 chars (title + body):", titleAndBodyStr.slice(0, 300));
        await saveDiagnostics(driver, handle, "blocked");
        return { status: "blocked", url, scraped: null, error: "blocked" };
      }
      const pageSource = await driver.getPageSource();
      const lower = pageSource.toLowerCase();
      if (/page not found|user not found|no statistics|doesn't exist|404/i.test(lower) && /socialblade|instagram/i.test(lower)) {
        await saveDiagnostics(driver, handle, "not_found");
        return { status: "not_found", url, scraped: null, error: "not_found" };
      }
      await dismissCookieBanner(driver);
      await sleep(500);
      const scraped = await scrapeSocialBladeStatsDom(driver);
      const hasAny = scraped.followers != null || scraped.following != null || scraped.posts != null ||
        scraped.engagementRate != null || scraped.avgLikes != null || scraped.avgComments != null;
      if (hasAny || scraped.missing.length < STAT_LABELS.length) {
        return { status: "ok", url, scraped, error: null };
      }
      lastError = "no_stats";
    } catch (err) {
      lastError = err?.message || String(err);
      await saveDiagnostics(driver, handle, "error").catch(() => {});
    }
    if (attempt < MAX_RETRIES) await randomDelay();
  }
  await saveDiagnostics(driver, handle, "error").catch(() => {});
  return { status: "error", url, scraped: null, error: lastError };
}

async function main() {
  const args = parseArgs();
  let players = await prisma.player.findMany({
    where: { instagram: { not: null, not: "" } },
    select: {
      id: true,
      name: true,
      instagram: true,
      followers: true,
      following: true,
      posts: true,
      engagementRate: true,
      avgLikes: true,
      avgComments: true,
      igEngagementRate: true,
      igAvgLikes: true,
      igAvgComments: true,
      igSbLastCheckedAt: true,
      igSbStatus: true,
    },
    orderBy: { name: "asc" },
  });

  if (args.startFrom) {
    const idx = players.findIndex((p) => p.name >= args.startFrom);
    if (idx >= 0) players = players.slice(idx);
  }
  if (args.limit != null && args.limit > 0) players = players.slice(0, args.limit);
  if (!args.force) {
    const cutoff = new Date(Date.now() - SKIP_IF_OK_DAYS * 24 * 60 * 60 * 1000);
    players = players.filter(
      (p) =>
        p.igSbLastCheckedAt == null ||
        p.igSbLastCheckedAt < cutoff ||
        (p.igSbStatus && p.igSbStatus !== "ok")
    );
  }
  if (args.onlyMissing) {
    players = players.filter(
      (p) =>
        p.followers == null ||
        p.posts == null ||
        p.igEngagementRate == null ||
        p.igAvgLikes == null ||
        p.igAvgComments == null ||
        p.engagementRate == null ||
        p.avgLikes == null ||
        p.avgComments == null
    );
  }

  console.log("Players to process:", players.length);
  const driver = await createDriver(args.headless);

  await loginToSocialBlade(driver);

  try {
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const handle = (p.instagram || "").trim().replace(/^@/, "").toLowerCase();
      const url = handle ? `https://socialblade.com/instagram/user/${handle}` : "";

      const result = await processOnePlayer(driver, p);
      const status = result.status;
      const scraped = result.scraped;

      if (status !== "ok") {
        appendFailedCsv(p.name, handle, result.error || status, result.url || url, scraped?.missing);
      }

      const followers = status === "ok" && scraped ? (scraped.followers ?? p.followers) : p.followers;
      const following = status === "ok" && scraped ? (scraped.following ?? p.following) : p.following;
      const posts = status === "ok" && scraped ? (scraped.posts ?? p.posts) : p.posts;
      const engagementRate = status === "ok" && scraped ? (scraped.engagementRate ?? p.engagementRate) : p.engagementRate;
      const avgLikes = status === "ok" && scraped ? (scraped.avgLikes ?? p.avgLikes) : p.avgLikes;
      const avgComments = status === "ok" && scraped ? (scraped.avgComments ?? p.avgComments) : p.avgComments;

      console.log(
        p.name,
        handle,
        url,
        status,
        followers ?? "-",
        following ?? "-",
        posts ?? "-",
        engagementRate != null ? engagementRate + "%" : "-",
        avgLikes ?? "-",
        avgComments ?? "-"
      );

      const data = {
        igSbLastCheckedAt: new Date(),
        igSbStatus: status,
      };
      if (status === "ok" && scraped) {
        if (scraped.followers != null) data.followers = scraped.followers;
        if (scraped.following != null) data.following = scraped.following;
        if (scraped.posts != null) data.posts = scraped.posts;
        if (scraped.engagementRate != null) {
          data.engagementRate = scraped.engagementRate;
          data.igEngagementRate = scraped.engagementRate;
        }
        if (scraped.avgLikes != null) {
          data.avgLikes = Math.round(scraped.avgLikes);
          data.igAvgLikes = scraped.avgLikes;
        }
        if (scraped.avgComments != null) {
          data.avgComments = Math.round(scraped.avgComments);
          data.igAvgComments = scraped.avgComments;
        }
        const updatedAny = scraped.followers != null || scraped.following != null || scraped.posts != null ||
          scraped.engagementRate != null || scraped.avgLikes != null || scraped.avgComments != null;
        if (updatedAny) data.instagramUpdatedAt = new Date();
      }
      await prisma.player.update({
        where: { id: p.id },
        data,
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
