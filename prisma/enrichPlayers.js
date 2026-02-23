require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const NBA_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com/",
  Accept: "application/json, text/plain, */*",
};

function parseHeight(nbaHeight) {
  if (nbaHeight == null || typeof nbaHeight !== "string") return { heightInches: null, heightText: null };
  const s = String(nbaHeight).trim();
  const match = s.match(/^(\d+)-(\d+)$/);
  if (!match) return { heightInches: null, heightText: null };
  const feet = parseInt(match[1], 10);
  const inches = parseInt(match[2], 10);
  if (Number.isNaN(feet) || Number.isNaN(inches) || feet < 0 || inches < 0 || inches > 11) {
    return { heightInches: null, heightText: null };
  }
  const heightInches = feet * 12 + inches;
  const heightText = `${feet}'${inches}"`;
  return { heightInches, heightText };
}

async function fetchCommonAllPlayers() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  const season = `${startYear}-${endYearShort}`;
  const url = new URL("https://stats.nba.com/stats/commonallplayers");
  url.searchParams.set("IsOnlyCurrentSeason", "1");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);
  const response = await fetch(url.toString(), { headers: NBA_HEADERS });
  if (!response.ok) throw new Error(`commonallplayers failed: ${response.status}`);
  const data = await response.json();
  const resultSets = data.resultSets || [];
  const playerSet = resultSets[0];
  if (!playerSet || !Array.isArray(playerSet.headers) || !Array.isArray(playerSet.rowSet)) {
    throw new Error("Unexpected commonallplayers response");
  }
  const headers = playerSet.headers;
  const idxId = headers.indexOf("PERSON_ID");
  const idxRoster = headers.indexOf("ROSTERSTATUS");
  const idxTeam = headers.indexOf("TEAM_ABBREVIATION");
  const idxPos = headers.indexOf("POSITION");
  const rosterMap = {};
  for (const row of playerSet.rowSet) {
    if (Number(row[idxRoster]) !== 1) continue;
    const id = String(row[idxId]);
    const team = idxTeam >= 0 && row[idxTeam] != null ? String(row[idxTeam]).trim() : null;
    const position = idxPos >= 0 && row[idxPos] != null ? String(row[idxPos]).trim() : null;
    rosterMap[id] = { team: team || null, position: position || null };
  }
  return rosterMap;
}

async function fetchCommonPlayerInfo(playerId) {
  const url = new URL("https://stats.nba.com/stats/commonplayerinfo");
  url.searchParams.set("PlayerID", String(playerId));
  const response = await fetch(url.toString(), { headers: NBA_HEADERS });
  if (!response.ok) return null;
  const data = await response.json();
  const resultSets = data.resultSets || [];
  const infoSet = resultSets.find((rs) => rs.name === "CommonPlayerInfo") || resultSets[0];
  if (!infoSet || !Array.isArray(infoSet.headers) || !Array.isArray(infoSet.rowSet) || infoSet.rowSet.length === 0) {
    return null;
  }
  const headers = infoSet.headers;
  const row = infoSet.rowSet[0];
  const idxHeight = headers.indexOf("HEIGHT");
  const idxPosition = headers.indexOf("POSITION");
  const idxTeam = headers.indexOf("TEAM_ABBREVIATION");
  const heightRaw = idxHeight >= 0 ? row[idxHeight] : null;
  const position = idxPosition >= 0 && row[idxPosition] != null ? String(row[idxPosition]).trim() : null;
  const team = idxTeam >= 0 && row[idxTeam] != null ? String(row[idxTeam]).trim() : null;
  const { heightInches, heightText } = parseHeight(heightRaw);
  return { team: team || null, position: position || null, heightInches, heightText };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const dbPlayers = await prisma.player.findMany({ select: { nbaPersonId: true } });
  const totalInDb = dbPlayers.length;
  console.log(`Total players in DB: ${totalInDb}`);

  let rosterMap = {};
  try {
    rosterMap = await fetchCommonAllPlayers();
    console.log(`Roster map from commonallplayers: ${Object.keys(rosterMap).length} active players`);
  } catch (err) {
    console.error("NBA API (commonallplayers) failed. Aborting to avoid corrupting data.", err.message);
    process.exit(1);
  }

  const BATCH_SIZE = 15;
  const DELAY_MS = 250;
  const UPDATE_CHUNK = 50;
  let updated = 0;
  let missingInSource = 0;
  const updates = [];

  for (let i = 0; i < dbPlayers.length; i += BATCH_SIZE) {
    const batch = dbPlayers.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((p) => fetchCommonPlayerInfo(p.nbaPersonId))
    );
    await sleep(DELAY_MS);

    for (let j = 0; j < batch.length; j++) {
      const nbaPersonId = batch[j].nbaPersonId;
      const info = results[j];
      const roster = rosterMap[nbaPersonId];
      const team = (info && info.team) || (roster && roster.team) || null;
      const position = (info && info.position) || (roster && roster.position) || null;
      const heightInches = info ? info.heightInches : null;
      const heightText = info ? info.heightText : null;
      if (info === null && !roster) missingInSource += 1;
      const hasUpdate =
        (team != null && team !== "") ||
        (position != null && position !== "") ||
        heightInches != null ||
        (heightText != null && heightText !== "");
      if (hasUpdate) {
        updates.push({
          nbaPersonId,
          team: team != null && team !== "" ? team : undefined,
          position: position != null && position !== "" ? position : undefined,
          heightInches: heightInches != null ? heightInches : undefined,
          heightText: heightText != null && heightText !== "" ? heightText : undefined,
        });
      }
    }
  }

  for (let k = 0; k < updates.length; k += UPDATE_CHUNK) {
    const chunk = updates.slice(k, k + UPDATE_CHUNK);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.player.update({
          where: { nbaPersonId: u.nbaPersonId },
          data: {
            ...(u.team !== undefined && { team: u.team }),
            ...(u.position !== undefined && { position: u.position }),
            ...(u.heightInches !== undefined && { heightInches: u.heightInches }),
            ...(u.heightText !== undefined && { heightText: u.heightText }),
          },
        })
      )
    );
    updated += chunk.length;
  }

  console.log(`Total updated: ${updated}`);
  console.log(`Total missing in source: ${missingInSource}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
