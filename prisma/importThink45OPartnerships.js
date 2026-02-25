require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function normalizeName(s) {
  if (s == null || typeof s !== "string") return "";
  let t = s.trim().toLowerCase();
  t = t.replace(/[\s\-.,]+/g, " ").trim();
  t = t.replace(/\s+/g, " ");
  t = t.replace(/\b(jr|sr|ii|iii|iv)\.?\s*$/i, "").trim();
  return t;
}

function parseOptionalInt(val) {
  if (val == null || String(val).trim() === "") return null;
  const n = parseInt(String(val).replace(/,/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}

function getCol(row, headers, ...names) {
  for (const n of names) {
    const key = headers.find((h) => h.trim().toLowerCase() === n.toLowerCase());
    if (key != null && row[key] !== undefined) return row[key];
  }
  return null;
}

async function main() {
  const csvPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve(process.cwd(), "data", "confidential_data.csv");

  if (!fs.existsSync(csvPath)) {
    console.error("CSV not found:", csvPath);
    console.error('Usage: node prisma/importThink45OPartnerships.js [path/to/file.csv]');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }

  const raw = fs.readFileSync(csvPath, "utf-8");
  const rows = parse(raw, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });

  const headers = rows.length ? Object.keys(rows[0]) : [];
  const playerCol = headers.find((h) => /^player$/i.test(h.trim()));
  if (!playerCol) {
    console.error("CSV must have a 'Player' column. Found:", headers);
    process.exit(1);
  }

  const allPlayers = await prisma.player.findMany({
    select: { id: true, name: true },
  });
  const byExactName = new Map(allPlayers.map((p) => [p.name.trim(), p]));
  const byNormalName = new Map(
    allPlayers.map((p) => [normalizeName(p.name), p])
  );

  let created = 0;
  let skippedNoPlayer = 0;
  let skippedDuplicate = 0;
  let errors = 0;

  for (const row of rows) {
    const playerNameRaw = (row[playerCol] || "").trim();
    if (!playerNameRaw) continue;

    let player = byExactName.get(playerNameRaw);
    if (!player) {
      const norm = normalizeName(playerNameRaw);
      player = byNormalName.get(norm);
    }
    if (!player) {
      skippedNoPlayer++;
      continue;
    }

    const brand = getCol(row, headers, "Brand") ?? "";
    const dates = getCol(row, headers, "Dates") ?? "";
    const activationType = getCol(row, headers, "Type of Activation") ?? "";
    if (!brand && !dates && !activationType) continue;

    const distribution = getCol(row, headers, "Distribution");
    const additionalNotes = getCol(row, headers, "Additional Notes");
    const playerFee = getCol(row, headers, "Player Fee");
    const caliber = getCol(row, headers, "Caliber");
    const igFollowers = parseOptionalInt(
      getCol(row, headers, "Instagram Followers")
    );
    const twitterFollowers = parseOptionalInt(
      getCol(row, headers, "Twitter Followers")
    );
    const reach = parseOptionalInt(
      getCol(row, headers, "Reach (Combined Following)")
    );

    try {
      await prisma.playerPartnership.upsert({
        where: {
          playerId_brand_dates_activationType: {
            playerId: player.id,
            brand: brand || "—",
            dates: dates || "—",
            activationType: activationType || "—",
          },
        },
        create: {
          playerId: player.id,
          brand: brand || "—",
          dates: dates || "—",
          activationType: activationType || "—",
          distribution: distribution != null && String(distribution).trim() !== "" ? String(distribution).trim() : null,
          additionalNotes: additionalNotes != null && String(additionalNotes).trim() !== "" ? String(additionalNotes).trim() : null,
          playerFee: playerFee != null && String(playerFee).trim() !== "" ? String(playerFee).trim() : null,
          caliber: caliber != null && String(caliber).trim() !== "" ? String(caliber).trim() : null,
          igFollowersAtTime: igFollowers,
          twitterFollowersAtTime: twitterFollowers,
          reachAtTime: reach,
        },
        update: {
          distribution: distribution != null && String(distribution).trim() !== "" ? String(distribution).trim() : null,
          additionalNotes: additionalNotes != null && String(additionalNotes).trim() !== "" ? String(additionalNotes).trim() : null,
          playerFee: playerFee != null && String(playerFee).trim() !== "" ? String(playerFee).trim() : null,
          caliber: caliber != null && String(caliber).trim() !== "" ? String(caliber).trim() : null,
          igFollowersAtTime: igFollowers,
          twitterFollowersAtTime: twitterFollowers,
          reachAtTime: reach,
        },
      });
      created++;
    } catch (err) {
      if (err.code === "P2002") skippedDuplicate++;
      else {
        errors++;
        console.error("Row error:", playerNameRaw, err.message);
      }
    }
  }

  console.log("Import summary:");
  console.log("  Rows processed:", rows.length);
  console.log("  Upserted:", created);
  console.log("  Skipped (no matching player):", skippedNoPlayer);
  console.log("  Skipped (duplicate):", skippedDuplicate);
  if (errors) console.log("  Errors:", errors);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
