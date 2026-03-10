/**
 * scripts/updateSocialBladeStats.js
 *
 * Scrapes SocialBlade Instagram stats using Selenium + Chrome (via Selenium Manager).
 * Works locally and in GitHub Actions (ubuntu-latest with Chrome installed).
 * DO NOT require('chromedriver') — Selenium Manager downloads it automatically.
 *
 * Usage:
 *   node scripts/updateSocialBladeStats.js
 *   node scripts/updateSocialBladeStats.js --force
 *   node scripts/updateSocialBladeStats.js --limit=20
 *   node scripts/updateSocialBladeStats.js --only-missing
 *
 * Env vars: DATABASE_URL, SOCIALBLADE_EMAIL, SOCIALBLADE_PASSWORD
 * Outputs:  data/ig_socialblade_failed.csv, data/debug/ (screenshots + html on errors)
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { PrismaClient }                       = require("../generated/prisma");
const { PrismaPg }                           = require("@prisma/adapter-pg");
const { Builder, By, until, Key }            = require("selenium-webdriver");
const chrome                                 = require("selenium-webdriver/chrome");
const fs                                     = require("fs");
const path                                   = require("path");
const { log }                                = require("../lib/logging");
const { parseIntClean, parseFloatClean,
        parsePercent, parseCountKmb }        = require("../lib/parseCount");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ── Config ────────────────────────────────────────────────────────────────────

const MIN_DELAY_MS     = 4000;
const MAX_DELAY_MS     = 8000;
const STALE_HOURS      = 24;
const MAX_RETRIES      = 2;
const DATA_DIR         = path.join(__dirname, "..", "data");
const DEBUG_DIR        = path.join(DATA_DIR, "debug");
const FAILED_CSV       = path.join(DATA_DIR, "ig_socialblade_failed.csv");
const IS_CI            = process.env.CI === "true";

// ── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const out  = { force: false, limit: null, onlyMissing: false };
  for (const a of args) {
    if (a === "--force")                     out.force       = true;
    if (a === "--only-missing")              out.onlyMissing = true;
    if (a.startsWith("--limit="))           out.limit       = parseInt(a.slice(8), 10) || null;
  }
  return out;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function randomDelay() {
  return sleep(MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function appendFailedCsv(name, handle, reason, url, missing) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const header = "name,instagram,reason,url,missing_stats\n";
  const row    = [name, handle, reason, url || "", Array.isArray(missing) ? missing.join("; ") : String(missing || "")]
    .map((f) => `"${String(f).replace(/"/g, '""')}"`)
    .join(",") + "\n";
  if (!fs.existsSync(FAILED_CSV)) fs.writeFileSync(FAILED_CSV, header + row, "utf8");
  else                             fs.appendFileSync(FAILED_CSV, row, "utf8");
}

async function saveDebug(driver, label) {
  try {
    fs.mkdirSync(DEBUG_DIR, { recursive: true });
    const slug = label.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    const ts   = Date.now();
    const shot = await driver.takeScreenshot();
    fs.writeFileSync(path.join(DEBUG_DIR, `${slug}_${ts}.png`), shot, "base64");
    const src  = await driver.getPageSource().catch(() => "");
    fs.writeFileSync(path.join(DEBUG_DIR, `${slug}_${ts}.html`), src, "utf8");
  } catch (_) {}
}

// ── Browser setup ─────────────────────────────────────────────────────────────

async function createDriver() {
  const options = new chrome.Options();

  // Anti-detection flags
  options.addArguments(
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-blink-features=AutomationControlled",
    "--disable-infobars",
    "--window-size=1280,900",
    "--lang=en-US",
    "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  options.excludeSwitches(["enable-automation"]);
  options.setUserPreferences({ "credentials_enable_service": false });

  // Always headless in CI; headless locally too for the daily run
  options.addArguments("--headless=new");

  // If CHROME_BIN is set (e.g. by browser-actions/setup-chrome in GH Actions), use it
  if (process.env.CHROME_BIN) {
    options.setChromeBinaryPath(process.env.CHROME_BIN);
  }

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  // Hide webdriver flag
  await driver.executeScript(
    "Object.defineProperty(navigator, 'webdriver', { get: () => undefined })"
  );

  return driver;
}

// ── Cloudflare / block detection ──────────────────────────────────────────────

async function detectBlock(driver) {
  const title  = await driver.getTitle().catch(() => "");
  const source = await driver.getPageSource().catch(() => "");
  const titleL  = title.toLowerCase();
  const sourceL = source.toLowerCase();
  if (
    titleL.includes("just a moment") ||
    sourceL.includes("cf-browser-verification") ||
    sourceL.includes("checking your browser") ||
    sourceL.includes("enable javascript and cookies") ||
    sourceL.includes("challenge-form") ||
    sourceL.includes("please wait") && sourceL.includes("cloudflare")
  ) {
    return "cloudflare";
  }
  if (sourceL.includes("you must be logged in") || (await driver.getCurrentUrl()).includes("/login")) {
    return "session_expired";
  }
  return null;
}

// ── SocialBlade login ─────────────────────────────────────────────────────────

async function loginToSocialBlade(driver) {
  const email    = process.env.SOCIALBLADE_EMAIL;
  const password = process.env.SOCIALBLADE_PASSWORD;

  if (!email || !password) {
    log("warn", "[social] No SOCIALBLADE_EMAIL/PASSWORD set — attempting without login");
    return false;
  }

  log("info", "[social] Navigating to SocialBlade…");
  await driver.get("https://socialblade.com");
  await sleep(3000);

  // Check Cloudflare on homepage
  const homeBlock = await detectBlock(driver);
  if (homeBlock === "cloudflare") {
    log("warn", "[social] Cloudflare detected on homepage — social scraping will be skipped");
    return false;
  }

  // Check if already logged in
  try {
    const logoutLink = await driver.findElement(By.xpath('//*[contains(@href,"logout") or contains(text(),"Dashboard")]'));
    if (logoutLink) { log("info", "[social] Already logged in"); return true; }
  } catch (_) {}

  log("info", "[social] Attempting login…");
  await driver.get("https://socialblade.com/login");
  await sleep(3000);

  const loginBlock = await detectBlock(driver);
  if (loginBlock === "cloudflare") {
    log("warn", "[social] Cloudflare on login page — cannot log in automatically in CI");
    await saveDebug(driver, "cloudflare_login");
    return false;
  }

  try {
    const emailEl = await driver.findElement(
      By.css('input[name="email"], input[type="email"], input[placeholder*="mail" i]')
    );
    const passEl  = await driver.findElement(
      By.css('input[name="password"], input[type="password"]')
    );
    await emailEl.sendKeys(email);
    await sleep(400);
    await passEl.sendKeys(password);
    await sleep(400);
    await passEl.sendKeys(Key.RETURN);
    await sleep(5000);

    const afterUrl = await driver.getCurrentUrl();
    if (afterUrl.includes("/login")) {
      log("warn", "[social] Login failed — still on login page (CAPTCHA likely required)");
      await saveDebug(driver, "login_failed");
      return false;
    }

    log("info", "[social] ✅ Login successful");
    return true;
  } catch (err) {
    log("warn", `[social] Login error: ${err.message}`);
    await saveDebug(driver, "login_error");
    return false;
  }
}

// ── Stat parsing config ───────────────────────────────────────────────────────

const STAT_DEFS = [
  { label: "Followers",        key: "followers",      parse: (t) => parseCountKmb(t) ?? parseIntClean(t)   },
  { label: "Following",        key: "following",      parse: (t) => parseCountKmb(t) ?? parseIntClean(t)   },
  { label: "Media Count",      key: "posts",          parse: (t) => parseCountKmb(t) ?? parseIntClean(t)   },
  { label: "Uploads",          key: "posts",          parse: (t) => parseCountKmb(t) ?? parseIntClean(t)   },
  { label: "Engagement Rate",  key: "engagementRate", parse: (t) => parsePercent(t)                        },
  { label: "Average Likes",    key: "avgLikes",       parse: (t) => parseFloatClean(t) ?? parseCountKmb(t) },
  { label: "Average Comments", key: "avgComments",    parse: (t) => parseFloatClean(t) ?? parseCountKmb(t) },
];

// ── Per-player scrape ─────────────────────────────────────────────────────────

async function scrapeSocialBlade(driver, handle) {
  const url = `https://socialblade.com/instagram/user/${encodeURIComponent(handle)}`;
  await driver.get(url);
  await sleep(3000);

  // Check for Cloudflare / auth wall
  const blockType = await detectBlock(driver);
  if (blockType === "cloudflare") return { status: "blocked", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null };
  if (blockType === "session_expired") return { status: "blocked", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null };

  const source = await driver.getPageSource();
  const srcL   = source.toLowerCase();

  // Not found
  if (/page not found|user not found|no statistics|doesn['']t exist|404/i.test(source)) {
    return { status: "not_found", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null };
  }

  // Wait for stats section
  try {
    await driver.wait(until.elementLocated(By.xpath('//*[contains(., "Followers")]')), 15000);
    await sleep(1500);
  } catch (_) {
    return { status: "error", url, followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: STAT_DEFS.map((s) => s.label) };
  }

  const out     = { followers: null, following: null, posts: null, engagementRate: null, avgLikes: null, avgComments: null, missing: [] };
  const pageText = await driver.executeScript("return document.body.innerText").catch(() => "");

  for (const { label, key, parse } of STAT_DEFS) {
    if (key === "posts" && out.posts != null) continue; // already got it from "Media Count"
    try {
      const xpath  = `//*[contains(normalize-space(.), '${label}')]`;
      const el     = await driver.findElement(By.xpath(xpath)).catch(() => null);
      if (!el) { out.missing.push(label); continue; }

      const blockText = await driver.executeScript(`
        const node = arguments[0];
        const ancestor = node.closest("div, td, li, span, section");
        return ancestor ? ancestor.innerText : node.innerText;
      `, el).catch(() => null);

      if (!blockText) { out.missing.push(label); continue; }

      let val = parse(blockText);

      // Fallback: extract the number that follows the label text
      if (val == null && blockText.includes(label)) {
        const rest     = blockText.replace(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "").trim();
        const numMatch = rest.match(/[\d,.]+%?|[\d,.]+\s*[KMBkmb]/);
        if (numMatch) val = parse(numMatch[0]);
      }

      if (val != null) out[key] = val;
      else             out.missing.push(label);
    } catch (_) {
      out.missing.push(label);
    }
  }

  const hasAny = Object.entries(out)
    .filter(([k]) => k !== "missing")
    .some(([, v]) => v != null);

  return { ...out, status: hasAny ? "ok" : "error", url };
}

// ── DB write ──────────────────────────────────────────────────────────────────

async function writeToDb(playerId, result) {
  const data = {
    igSbLastCheckedAt: new Date(),
    igSbStatus:        result.status,
  };

  if (result.status === "ok") {
    if (result.followers      != null) data.followers      = result.followers;
    if (result.following      != null) data.following      = result.following;
    if (result.posts          != null) data.posts          = result.posts;
    if (result.engagementRate != null) {
      data.engagementRate = result.engagementRate;
      data.igEngagementRate = result.engagementRate;
    }
    if (result.avgLikes != null) {
      data.avgLikes   = Math.round(result.avgLikes);
      data.igAvgLikes = result.avgLikes;
    }
    if (result.avgComments != null) {
      data.avgComments   = Math.round(result.avgComments);
      data.igAvgComments = result.avgComments;
    }
    const anyStats = result.followers != null || result.following != null || result.posts != null ||
      result.engagementRate != null || result.avgLikes != null || result.avgComments != null;
    if (anyStats) data.instagramUpdatedAt = new Date();
  }

  await prisma.player.update({ where: { id: playerId }, data });
}

// ── Main export ───────────────────────────────────────────────────────────────

async function run({ force = false, limit = null, onlyMissing = false } = {}) {
  const stats = { processed: 0, ok: 0, blocked: 0, not_found: 0, error: 0, skipped: 0 };

  // Load players that need updating
  const staleCutoff = new Date(Date.now() - STALE_HOURS * 60 * 60 * 1000);
  let players = await prisma.player.findMany({
    where: { instagram: { not: null } },
    select: {
      id: true, name: true, instagram: true,
      followers: true, following: true, posts: true,
      engagementRate: true, avgLikes: true, avgComments: true,
      igEngagementRate: true, igAvgLikes: true, igAvgComments: true,
      igSbLastCheckedAt: true, igSbStatus: true,
    },
    orderBy: { name: "asc" },
  });

  // Filter out empty handles
  players = players.filter((p) => p.instagram && p.instagram.trim());

  // Skip recently-OK players unless --force
  if (!force) {
    players = players.filter(
      (p) =>
        p.igSbLastCheckedAt == null ||
        p.igSbLastCheckedAt < staleCutoff ||
        (p.igSbStatus && p.igSbStatus !== "ok")
    );
  }

  if (onlyMissing) {
    players = players.filter(
      (p) =>
        p.followers == null || p.posts == null ||
        p.igEngagementRate == null || p.igAvgLikes == null || p.igAvgComments == null
    );
  }

  if (limit != null && limit > 0) players = players.slice(0, limit);

  log("info", `[social] ${players.length} players to scrape`);

  if (players.length === 0) {
    log("info", "[social] Nothing to do — all players are fresh");
    return stats;
  }

  // Launch browser
  let driver;
  try {
    driver = await createDriver();
  } catch (err) {
    log("error", `[social] Failed to launch Chrome: ${err.message}`);
    stats.error = players.length;
    return stats;
  }

  try {
    // Login
    const loggedIn = await loginToSocialBlade(driver);
    if (!loggedIn) {
      log("warn", "[social] Not logged in — pages may be blocked by Cloudflare");
    }

    for (const player of players) {
      stats.processed++;
      const handle = player.instagram.trim().replace(/^@/, "").toLowerCase();

      log("info", `[social] Scraping @${handle} (${player.name})…`);

      let result;
      let attempts = 0;

      while (attempts < MAX_RETRIES) {
        attempts++;
        try {
          result = await scrapeSocialBlade(driver, handle);
          break;
        } catch (err) {
          log("warn", `[social] Attempt ${attempts} failed for ${player.name}: ${err.message}`);
          if (attempts < MAX_RETRIES) await sleep(3000);
          else result = { status: "error", url: `https://socialblade.com/instagram/user/${handle}` };
        }
      }

      const { status } = result;
      stats[status] = (stats[status] ?? 0) + 1;

      // Log per-player summary
      const f = result.followers   != null ? String(result.followers)   : "—";
      const e = result.engagementRate != null ? `${result.engagementRate}%` : "—";
      log("info", `  [${status.toUpperCase()}] ${player.name} | followers=${f} | eng=${e}`);

      if (status !== "ok" && status !== "not_found") {
        appendFailedCsv(player.name, handle, status, result.url, result.missing ?? []);
        await saveDebug(driver, `${handle}_${status}`);
      }

      // Write to DB
      try {
        await writeToDb(player.id, result);
      } catch (err) {
        log("error", `[social] DB write failed for ${player.name}: ${err.message}`);
      }

      // Back off between requests
      await randomDelay();
    }
  } finally {
    await driver.quit().catch(() => {});
  }

  log("info", `[social] ✅ processed=${stats.processed} ok=${stats.ok} blocked=${stats.blocked ?? 0} error=${stats.error ?? 0} not_found=${stats.not_found ?? 0}`);
  return stats;
}

module.exports = { run };

// ── Standalone entry point ────────────────────────────────────────────────────
if (require.main === module) {
  const args = parseArgs();
  run(args)
    .then((stats) => {
      console.log("\n── Social stats update complete ──");
      console.log(JSON.stringify(stats, null, 2));
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      prisma.$disconnect();
      process.exit(1);
    });
}
