require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

async function fetchRosterFromNBA() {
  const season = getCurrentSeason();
  const url = new URL("https://stats.nba.com/stats/commonallplayers");
  url.searchParams.set("IsOnlyCurrentSeason", "1");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);
  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: "https://www.nba.com/",
      Origin: "https://www.nba.com/",
      Accept: "application/json, text/plain, */*",
    },
  });
  if (!response.ok) throw new Error(`NBA API failed: ${response.status}`);
  const data = await response.json();
  const resultSets = data.resultSets || [];
  const playerSet = resultSets[0];
  if (!playerSet || !Array.isArray(playerSet.headers) || !Array.isArray(playerSet.rowSet)) {
    throw new Error("Unexpected NBA API response shape");
  }
  const headers = playerSet.headers;
  const idxId = headers.indexOf("PERSON_ID");
  const idxName = headers.indexOf("DISPLAY_FIRST_LAST");
  const idxRoster = headers.indexOf("ROSTERSTATUS");
  const idxTeam = headers.indexOf("TEAM_ABBREVIATION");
  const idxPos = headers.indexOf("POSITION");
  if (idxId === -1 || idxName === -1 || idxRoster === -1) {
    throw new Error("Missing expected columns in NBA API response");
  }
  const rows = playerSet.rowSet.filter((row) => Number(row[idxRoster]) === 1);
  return rows.map((row) => {
    const nbaPersonId = String(row[idxId]);
    const name = String(row[idxName] || "").trim() || "Unknown";
    const team = idxTeam >= 0 && row[idxTeam] != null ? String(row[idxTeam]).trim() : null;
    const position = idxPos >= 0 && row[idxPos] != null ? String(row[idxPos]).trim() : null;
    return {
      nbaPersonId,
      name,
      team: team || undefined,
      position: position || undefined,
    };
  });
}

async function main() {
  console.log("Fetching roster from NBA API…");
  const roster = await fetchRosterFromNBA();
  console.log(`Fetched ${roster.length} active players.`);
  const payload = roster.map((p) => ({
    nbaPersonId: p.nbaPersonId,
    name: p.name,
    team: p.team != null && p.team !== "" ? p.team : null,
    position: p.position != null && p.position !== "" ? p.position : null,
  }));
  const result = await prisma.player.createMany({
    data: payload,
    skipDuplicates: true,
  });
  console.log(`Created ${result.count} new rows (skipped duplicates).`);
  const total = await prisma.player.count();
  console.log(`Neon Player table now has ${total} rows.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
