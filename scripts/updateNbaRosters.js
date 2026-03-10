/**
 * scripts/updateNbaRosters.js
 *
 * Upserts NBA player/roster data from stats.nba.com into Neon.
 * Idempotent — safe to run multiple times.
 * No API key required.
 *
 * Usage (standalone):  node scripts/updateNbaRosters.js
 * As module:           const { run } = require('./updateNbaRosters');
 */
"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { PrismaClient } = require("../generated/prisma");
const { PrismaPg }     = require("@prisma/adapter-pg");
const { log }          = require("../lib/logging");

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ── NBA API ───────────────────────────────────────────────────────────────────

const NBA_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin:  "https://www.nba.com/",
  Accept:  "application/json, text/plain, */*",
};

function getCurrentSeason() {
  const now       = new Date();
  const startYear = now.getMonth() >= 9 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

function parseHeight(raw) {
  if (!raw || typeof raw !== "string") return { heightInches: null, heightText: null };
  const m = raw.trim().match(/^(\d+)-(\d+)$/);
  if (!m) return { heightInches: null, heightText: null };
  const feet = parseInt(m[1], 10);
  const inches = parseInt(m[2], 10);
  if (Number.isNaN(feet) || Number.isNaN(inches) || inches > 11) {
    return { heightInches: null, heightText: null };
  }
  return { heightInches: feet * 12 + inches, heightText: `${feet}'${inches}"` };
}

async function fetchAllPlayers() {
  const season = getCurrentSeason();
  const url = new URL("https://stats.nba.com/stats/commonallplayers");
  url.searchParams.set("IsOnlyCurrentSeason", "1");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);

  const res = await fetch(url.toString(), { headers: NBA_HEADERS });
  if (!res.ok) throw new Error(`commonallplayers HTTP ${res.status}`);

  const data = await res.json();
  const ps   = data.resultSets?.[0];
  if (!ps?.headers || !ps?.rowSet) throw new Error("Unexpected commonallplayers shape");

  const h         = ps.headers;
  const idxId     = h.indexOf("PERSON_ID");
  const idxName   = h.indexOf("DISPLAY_FIRST_LAST");
  const idxRoster = h.indexOf("ROSTERSTATUS");
  const idxTeam   = h.indexOf("TEAM_ABBREVIATION");
  const idxPos    = h.indexOf("POSITION");

  if (idxId === -1 || idxName === -1) throw new Error("Missing required columns in NBA API response");

  return ps.rowSet
    .filter((r) => Number(r[idxRoster]) === 1)
    .map((r) => ({
      nbaPersonId: String(r[idxId]),
      name:        String(r[idxName] || "").trim() || "Unknown",
      team:        idxTeam >= 0 && r[idxTeam] ? String(r[idxTeam]).trim() || null : null,
      position:    idxPos  >= 0 && r[idxPos]  ? String(r[idxPos]).trim()  || null : null,
    }));
}

async function fetchPlayerInfo(nbaPersonId) {
  const url = new URL("https://stats.nba.com/stats/commonplayerinfo");
  url.searchParams.set("PlayerID", String(nbaPersonId));
  try {
    const res = await fetch(url.toString(), { headers: NBA_HEADERS });
    if (!res.ok) return null;
    const data    = await res.json();
    const infoSet = data.resultSets?.find((rs) => rs.name === "CommonPlayerInfo") ?? data.resultSets?.[0];
    if (!infoSet?.rowSet?.[0]) return null;
    const headers = infoSet.headers;
    const row     = infoSet.rowSet[0];
    const get     = (col) => { const i = headers.indexOf(col); return i >= 0 ? row[i] : null; };
    const team     = get("TEAM_ABBREVIATION") ? String(get("TEAM_ABBREVIATION")).trim() : null;
    const position = get("POSITION")          ? String(get("POSITION")).trim()          : null;
    return { team: team || null, position: position || null, ...parseHeight(get("HEIGHT")) };
  } catch {
    return null;
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Main export ───────────────────────────────────────────────────────────────

async function run() {
  const stats = { fetched: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };

  // 1. Fetch from NBA API
  log("info", `[rosters] Fetching active roster from stats.nba.com (season ${getCurrentSeason()})…`);
  let apiPlayers;
  try {
    apiPlayers  = await fetchAllPlayers();
    stats.fetched = apiPlayers.length;
    log("info", `[rosters] ${apiPlayers.length} active players from API`);
  } catch (err) {
    log("error", `[rosters] NBA API call failed: ${err.message}`);
    throw err;
  }

  // 2. Load DB players
  const dbPlayers = await prisma.player.findMany({
    select: { id: true, nbaPersonId: true, name: true, team: true, position: true, heightInches: true },
  });
  const dbMap = new Map(dbPlayers.map((p) => [p.nbaPersonId, p]));
  log("info", `[rosters] ${dbPlayers.length} players currently in DB`);

  // 3. Diff: classify each API player as insert / update / unchanged
  const toInsert = [];
  const toUpdate = [];

  for (const p of apiPlayers) {
    const existing = dbMap.get(p.nbaPersonId);
    if (!existing) {
      toInsert.push(p);
    } else {
      const changed =
        p.name     !== existing.name     ||
        p.team     !== existing.team     ||
        p.position !== existing.position;
      if (changed) {
        toUpdate.push({ ...p, id: existing.id });
      } else {
        stats.unchanged++;
      }
    }
  }

  // 4. Insert new players
  if (toInsert.length > 0) {
    log("info", `[rosters] Inserting ${toInsert.length} new players…`);
    try {
      const result = await prisma.player.createMany({
        data: toInsert.map((p) => ({
          nbaPersonId: p.nbaPersonId,
          name:        p.name,
          team:        p.team,
          position:    p.position,
        })),
        skipDuplicates: true,
      });
      stats.inserted = result.count;
      log("info", `[rosters] Inserted ${result.count} players`);
    } catch (err) {
      log("error", `[rosters] createMany failed: ${err.message}`);
      stats.failed += toInsert.length;
    }
  }

  // 5. Update changed players (chunks of 50)
  if (toUpdate.length > 0) {
    log("info", `[rosters] Updating ${toUpdate.length} changed players…`);
    const CHUNK = 50;
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const chunk = toUpdate.slice(i, i + CHUNK);
      try {
        await prisma.$transaction(
          chunk.map((p) =>
            prisma.player.update({
              where: { id: p.id },
              data: {
                name:     p.name,
                team:     p.team,
                position: p.position,
              },
            })
          )
        );
        stats.updated += chunk.length;
      } catch (err) {
        log("error", `[rosters] update chunk failed: ${err.message}`);
        stats.failed += chunk.length;
      }
    }
  }

  // 6. Fetch height for newly inserted players that don't have it yet
  const newPlayerIds = toInsert.map((p) => p.nbaPersonId);
  if (newPlayerIds.length > 0) {
    const newPlayers = await prisma.player.findMany({
      where: { nbaPersonId: { in: newPlayerIds }, heightInches: null },
      select: { id: true, nbaPersonId: true, name: true },
    });
    if (newPlayers.length > 0) {
      log("info", `[rosters] Fetching height for ${newPlayers.length} new players…`);
      const BATCH = 10;
      for (let i = 0; i < newPlayers.length; i += BATCH) {
        const batch = newPlayers.slice(i, i + BATCH);
        const infos = await Promise.all(batch.map((p) => fetchPlayerInfo(p.nbaPersonId)));
        for (let j = 0; j < batch.length; j++) {
          const info = infos[j];
          const p    = batch[j];
          if (info?.heightInches) {
            try {
              await prisma.player.update({
                where: { id: p.id },
                data: {
                  heightInches: info.heightInches,
                  heightText:   info.heightText,
                  ...(info.team     && { team:     info.team }),
                  ...(info.position && { position: info.position }),
                },
              });
              log("info", `[rosters] Height set for ${p.name}: ${info.heightText}`);
            } catch (err) {
              log("warn", `[rosters] Height update failed for ${p.name}: ${err.message}`);
            }
          }
        }
        await sleep(250);
      }
    }
  }

  log("info", `[rosters] ✅ fetched=${stats.fetched} inserted=${stats.inserted} updated=${stats.updated} unchanged=${stats.unchanged} failed=${stats.failed}`);
  return stats;
}

module.exports = { run };

// ── Standalone entry point ────────────────────────────────────────────────────
if (require.main === module) {
  run()
    .then((stats) => {
      console.log("\n── Roster update complete ──");
      console.log(JSON.stringify(stats, null, 2));
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      prisma.$disconnect();
      process.exit(1);
    });
}
