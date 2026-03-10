/**
 * scripts/dailyUpdate.js
 *
 * Daily orchestrator — runs NBA roster update then SocialBlade social stats.
 * Exits with code 0 if at least the roster update succeeded.
 * Exits with code 1 only if the entire pipeline fails.
 *
 * Usage:
 *   node scripts/dailyUpdate.js
 *   node scripts/dailyUpdate.js --skip-social   (roster only)
 *   node scripts/dailyUpdate.js --force-social   (force re-scrape all)
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { log, section } = require("../lib/logging");
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg }     = require("@prisma/adapter-pg");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    skipSocial:  args.includes("--skip-social"),
    forceSocial: args.includes("--force-social"),
  };
}

async function main() {
  const args     = parseArgs();
  const started  = Date.now();
  let   exitCode = 0;

  section("🏀 NBA Daily Data Update");
  log("info", `Started at ${new Date().toISOString()}`);
  log("info", `Environment: ${process.env.CI === "true" ? "GitHub Actions (CI)" : "local"}`);

  // ── 1. NBA Roster Update ──────────────────────────────────────────────────

  section("Step 1 — NBA Roster Update");
  let rosterStats = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  let rosterOk    = false;

  try {
    const { run: runRosters } = require("./updateNbaRosters");
    rosterStats = await runRosters();
    rosterOk    = true;
    log("info", "[orchestrator] Roster update succeeded");
  } catch (err) {
    log("error", `[orchestrator] Roster update FAILED: ${err.message}`);
    exitCode = 1;
  }

  // ── 2. SocialBlade Social Stats ───────────────────────────────────────────

  section("Step 2 — SocialBlade Social Stats");
  let socialStats = { processed: 0, ok: 0, blocked: 0, error: 0, not_found: 0 };

  if (args.skipSocial) {
    log("info", "[orchestrator] --skip-social flag set — skipping social scrape");
  } else {
    try {
      const { run: runSocial } = require("./updateSocialBladeStats");
      socialStats = await runSocial({ force: args.forceSocial });
      log("info", "[orchestrator] Social stats update completed");
    } catch (err) {
      log("error", `[orchestrator] Social stats update FAILED: ${err.message}`);
      // Do NOT change exitCode — social failing alone is not a total failure
      // as long as roster succeeded
    }
  }

  // ── 3. Daily Summary ──────────────────────────────────────────────────────

  section("Daily Summary");
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  console.log(`
  ┌─────────────────────────────────────────────┐
  │              DAILY UPDATE SUMMARY            │
  ├─────────────────────────────────────────────┤
  │  Roster                                      │
  │    API players fetched : ${String(rosterStats.fetched).padEnd(4)}                  │
  │    Inserted            : ${String(rosterStats.inserted).padEnd(4)}                  │
  │    Updated             : ${String(rosterStats.updated).padEnd(4)}                  │
  │    Unchanged           : ${String(rosterStats.unchanged).padEnd(4)}                  │
  │    Failed              : ${String(rosterStats.failed).padEnd(4)}                  │
  ├─────────────────────────────────────────────┤
  │  Social (SocialBlade)                        │
  │    Processed           : ${String(socialStats.processed ?? 0).padEnd(4)}                  │
  │    OK                  : ${String(socialStats.ok ?? 0).padEnd(4)}                  │
  │    Blocked / CAPTCHA   : ${String(socialStats.blocked ?? 0).padEnd(4)}                  │
  │    Not found           : ${String(socialStats.not_found ?? 0).padEnd(4)}                  │
  │    Error               : ${String(socialStats.error ?? 0).padEnd(4)}                  │
  ├─────────────────────────────────────────────┤
  │  Elapsed: ${elapsed}s${" ".repeat(35 - elapsed.length - 1)}│
  │  Exit code: ${exitCode}${" ".repeat(33)}│
  └─────────────────────────────────────────────┘`);

  await prisma.$disconnect();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("[orchestrator] Fatal error:", err);
  prisma.$disconnect();
  process.exit(1);
});
