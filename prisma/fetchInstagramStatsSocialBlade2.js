/**
 * Instagram stats via SocialBlade v2 (Playwright + DuckDuckGo browser).
 * Uses canonical URL: https://socialblade.com/instagram/user/<handle>
 * DOM-based scrape: Followers, Following, Media Count,
 * Engagement Rate, Average Likes, Average Comments.
 *
 * Requires DuckDuckGo for Mac: https://duckduckgo.com/mac
 *
 * How to run:
 *   npm run ig:stats:socialblade2 -- --limit=10
 *   npm run ig:stats:socialblade2 -- --limit=50 --startFrom="Stephen Curry"
 *   npm run ig:stats:socialblade2 -- --only-missing
 *   npm run ig:stats:socialblade2 -- --force --limit=25
 *
 * CLI: --headless, --limit=N, --startFrom="Name", --force, --only-missing
 * Failures: data/ig_socialblade_failed2.csv
 * Browser profile: data/ddg-profile (persists login session between runs)
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const MIN_DELAY_MS = 4000;
const MAX_DELAY_MS = 8000;
const SKIP_IF_OK_DAYS = 7;
const FAILED_CSV = path.join(__dirname, "..", "data", "ig_socialblade_failed2.csv");
const DDG_PATH = "/Applications/DuckDuckGo.app/Contents/MacOS/DuckDuckGo";
const DDG_PROFILE_DIR = path.join(__dirname, "..", "data", "ddg-profile");

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { headless: false, limit: null, startFrom: null, force: false, onlyMissing: false };
  for (const a of args) {
    if (a === "--headless") out.headless = true;
    else if (a === "--force") out.force = true;
    else if (a === "--only-missing") out.onlyMissing = true;
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10) || null;
    else if (a.startsWith("--startFrom="))
      out.startFrom = a.slice(12).replace(/^["']|["']$/g, "").trim() || null;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randomDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

// Navigate and wait for the page to actually load
async function goto(page, url) {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}),
    page.evaluate((u) => { window.location.href = u; }, url),
  ]);
  await sleep(2500);
}

function parseIntClean(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t.length) return null;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? null : n;
}

function parseFloatClean(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "");
  if (!t.length) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

function parsePercent(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/%/g, "").replace(/,/g, "");
  if (!t.length) return null;
  const n = parseFloat(t);
  return Number.isNaN(n) ? null : n;
}

function parseCountKmb(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/,/g, "").replace(/\s/g, "");
  if (!t.length || t === "---" || /^[-–—]+$/.test(t)) return null;
  const match = t.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  let n = parseFloat(match[1]);
  if (Number.isNaN(n)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

function appendFailedCsv(name, instagram, reason, url, missingStats) {
  const dir = path.dirname(FAILED_CSV);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const exists = fs.existsSync(FAILED_CSV);
  const missingStr = Array.isArray(missingStats) ? missingStats.join("; ") : String(missingStats || "");
  const row =
    [name, instagram, reason, url || "", missingStr]
      .map((f) => `"${String(f).replace(/"/g, '""')}"`)
      .join(",") + "\n";
  if (!exists) fs.writeFileSync(FAILED_CSV, "name,instagram,reason,url,missing_stats\n" + row, "utf-8");
  else fs.appendFileSync(FAILED_CSV, row, "utf-8");
}

// ─────────────────────────────────────────────────────────────────────────────
// Browser
// ─────────────────────────────────────────────────────────────────────────────

async function createBrowser(headless) {
  if (!fs.existsSync(DDG_PATH)) {
    throw new Error(
      `DuckDuckGo browser not found at ${DDG_PATH}.\n` +
      "Please install DuckDuckGo for Mac from https://duckduckgo.com/mac and try again."
    );
  }
  console.log("[browser] launching DuckDuckGo...");
  if (!fs.existsSync(DDG_PROFILE_DIR)) {
    fs.mkdirSync(DDG_PROFILE_DIR, { recursive: true });
  }
  const context = await chromium.launchPersistentContext(DDG_PROFILE_DIR, {
    executablePath: DDG_PATH,
    headless: headless || false,
    viewport: { width: 1280, height: 900 },
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  // Use the existing page that opens automatically, don't create a new one
  const pages = context.pages();
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  await sleep(2000);
  return { context, page };
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

async function loginToSocialBlade(page) {
  console.log("[login] Navigating to Social Blade...");
  await goto(page, "https://socialblade.com");

  // Check already logged in
  const alreadyLoggedIn =
    (await page.$('[href*="logout"]')) ||
    (await page.$('[href*="dashboard"]')) ||
    (await page.$('xpath=//a[contains(normalize-space(.), "Dashboard")]'));
  if (alreadyLoggedIn) {
    console.log("✅ Already logged in, skipping login");
    return;
  }

  const email = process.env.SOCIALBLADE_EMAIL;
  const password = process.env.SOCIALBLADE_PASSWORD;
  if (!email || !password) {
    throw new Error("SOCIALBLADE_EMAIL and SOCIALBLADE_PASSWORD must be set in .env");
  }

  console.log("[login] Navigating to login page...");
  await goto(page, "https://socialblade.com/login");
  console.log("[login] Current URL:", page.url());

  // Fill email
  let emailEl = null;
  for (const sel of ['input[name="email"]', 'input[type="email"]', 'input[placeholder*="mail" i]']) {
    emailEl = await page.$(sel);
    if (emailEl) break;
  }
  if (!emailEl) {
    const bodyText = await page.evaluate("document.body.innerText").catch(() => "");
    throw new Error(`[login] Email input not found. Page: ${String(bodyText).slice(0, 200)}`);
  }

  // Fill password
  let passEl = null;
  for (const sel of ['input[name="password"]', 'input[type="password"]']) {
    passEl = await page.$(sel);
    if (passEl) break;
  }
  if (!passEl) throw new Error("[login] Password input not found");

  await emailEl.fill(email);
  await sleep(300);
  await passEl.fill(password);
  await sleep(300);

  // Pause for CAPTCHA
  console.log("\n" + "─".repeat(60));
  console.log("⏸  ACTION REQUIRED:");
  console.log('   Click the Cloudflare "Verify you are human" checkbox');
  console.log("   in the DuckDuckGo browser window.");
  console.log("   Then press Enter here to continue.");
  console.log("─".repeat(60));
  await waitForEnter("   → Press Enter when done: ");

  // Click Login button
  let submitted = false;
  for (const sel of ['button[type="submit"]', 'input[type="submit"]', 'form button']) {
    const btn = await page.$(sel);
    if (btn) { await btn.click(); submitted = true; break; }
  }
  if (!submitted) {
    const btn = await page.$('xpath=//button[contains(., "Log in") or contains(., "Login") or contains(., "Sign in")]');
    if (btn) { await btn.click(); submitted = true; }
  }
  if (!submitted) throw new Error("[login] Could not find Login button");

  await sleep(4000);

  const afterUrl = page.url();
  if (afterUrl.includes("/login")) {
    const bodySnippet = await page.evaluate("document.body.innerText").catch(() => "");
    throw new Error(`[login] Still on login page (${afterUrl}). Page: ${String(bodySnippet).slice(0, 300)}`);
  }

  console.log("✅ Login successful — session saved for future runs");
  await sleep(1500);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scraper
// ─────────────────────────────────────────────────────────────────────────────

const STAT_LABELS = [
  { label: "Followers",        key: "followers",      parse: (t) => parseCountKmb(t) ?? parseIntClean(t) },
  { label: "Following",        key: "following",      parse: (t) => parseCountKmb(t) ?? parseIntClean(t) },
  { label: "Media Count",      key: "posts",          parse: (t) => parseCountKmb(t) ?? parseIntClean(t) },
  { label: "Uploads",          key: "posts",          parse: (t) => parseCountKmb(t) ?? parseIntClean(t) },
  { label: "Engagement Rate",  key: "engagementRate", parse: (t) => parsePercent(t) },
  { label: "Average Likes",    key: "avgLikes",       parse: (t) => parseFloatClean(t) ?? parseCountKmb(t) },
  { label: "Average Comments", key: "avgComments",    parse: (t) => parseFloatClean(t) ?? parseCountKmb(t) },
];

async function scrapePlayer(page, handle) {
  const url = `https://socialblade.com/instagram/user/${encodeURIComponent(handle)}`;
  await goto(page, url);

  // Session expiry check
  if (page.url().includes("/login")) {
    console.log("[auth] session expired — redirected to login");
    throw Object.assign(new Error("session_expired"), { sessionExpired: true });
  }

  const pageSource = await page.content();

  // Must be logged in wall
  if (pageSource.toLowerCase().includes("you must be logged in")) {
    throw Object.assign(new Error("session_expired"), { sessionExpired: true });
  }

  // Not found check
  if (
    /page not found|user not found|no statistics|doesn['']t exist|404/i.test(pageSource) &&
    /socialblade|instagram/i.test(pageSource)
  ) {
    return { status: "not_found", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: [] };
  }

  // Wait for stats to appear
  try {
    await page.waitForSelector('xpath=//*[contains(., "Followers")]', { timeout: 15000 });
    await sleep(1500);
  } catch (_) {
    return { status: "error", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: STAT_LABELS.map((s) => s.label) };
  }

  const out = { followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: [] };

  for (const { label, key, parse } of STAT_LABELS) {
    if (key === "posts" && out.posts != null) continue;
    try {
      const escapedLabel = label.replace(/'/g, "\\'");
      const el = await page.$(`xpath=//*[contains(normalize-space(.), '${escapedLabel}')]`);
      if (!el) { out.missing.push(label); continue; }

      let blockText = await el.evaluate((node) => {
        const ancestor = node.closest("div, td, li, span");
        return ancestor ? ancestor.innerText : node.innerText;
      });

      if (!blockText || blockText.length > 200) {
        const parentText = await el.evaluate((node) => {
          const ancestor = node.closest("div, td, li, span");
          return ancestor?.parentElement ? ancestor.parentElement.innerText : null;
        });
        if (parentText) blockText = parentText;
      }

      if (!blockText) { out.missing.push(label); continue; }

      let val = parse(blockText);
      if (val == null && blockText.includes(label)) {
        const rest = blockText
          .replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "")
          .trim();
        const numMatch = rest.match(/[\d,.]+%?|\d[\d,.]*(?:[KMB])?/);
        if (numMatch) val = parse(numMatch[0]);
      }
      if (val != null) out[key] = val;
      else out.missing.push(label);
    } catch (_) {
      out.missing.push(label);
    }
  }

  const hasAny = out.followers != null || out.following != null || out.posts != null ||
    out.engagementRate != null || out.avgLikes != null || out.avgComments != null;

  return { ...out, status: hasAny ? "ok" : "error", url };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

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

  const { context, page } = await createBrowser(args.headless);

  try {
    await loginToSocialBlade(page);

    for (const p of players) {
      const handle = (p.instagram || "").trim().replace(/^@/, "").toLowerCase();
      if (!handle) {
        appendFailedCsv(p.name, p.instagram || "", "empty_handle", "", []);
        continue;
      }
      const url = `https://socialblade.com/instagram/user/${encodeURIComponent(handle)}`;

      let result;
      try {
        result = await scrapePlayer(page, handle);
      } catch (err) {
        if (err.sessionExpired) {
          console.log("[auth] re-logging in before retry...");
          await loginToSocialBlade(page);
          try {
            result = await scrapePlayer(page, handle);
          } catch (retryErr) {
            result = { status: "error", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: [], error: retryErr?.message || String(retryErr) };
          }
        } else {
          result = { status: "error", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: [], error: err?.message || String(err) };
        }
      }

      const { status } = result;
      if (status !== "ok") {
        appendFailedCsv(p.name, handle, result.error || status, result.url || url, result.missing);
      }

      console.log(
        p.name, handle, status,
        result.followers ?? "-",
        result.following ?? "-",
        result.posts ?? "-",
        result.engagementRate != null ? result.engagementRate + "%" : "-",
        result.avgLikes ?? "-",
        result.avgComments ?? "-"
      );

      const data = { igSbLastCheckedAt: new Date(), igSbStatus: status };
      if (status === "ok" && result) {
        if (result.followers      != null) data.followers      = result.followers;
        if (result.following      != null) data.following      = result.following;
        if (result.posts          != null) data.posts          = result.posts;
        if (result.engagementRate != null) { data.engagementRate = result.engagementRate; data.igEngagementRate = result.engagementRate; }
        if (result.avgLikes       != null) { data.avgLikes = Math.round(result.avgLikes); data.igAvgLikes = result.avgLikes; }
        if (result.avgComments    != null) { data.avgComments = Math.round(result.avgComments); data.igAvgComments = result.avgComments; }
        const updatedAny = result.followers != null || result.following != null || result.posts != null ||
          result.engagementRate != null || result.avgLikes != null || result.avgComments != null;
        if (updatedAny) data.instagramUpdatedAt = new Date();
      }

      await prisma.player.update({ where: { id: p.id }, data });
      await randomDelay();
    }
  } finally {
    await context.close();
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
