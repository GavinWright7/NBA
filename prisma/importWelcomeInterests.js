/**
 * prisma/importWelcomeInterests.js
 *
 * Imports player interests from the NBPA Welcome Survey CSV (SurveyMonkey format).
 * Idempotent: safe to run multiple times.
 *
 * Usage:
 *   node prisma/importWelcomeInterests.js [path/to/Welcome.csv]
 *   (defaults to data/Welcome.csv if no path given)
 *
 * Outputs:
 *   data/unmatched_welcome.csv  — players whose names couldn't be matched to the DB
 *
 * After schema changes, run first:
 *   npx prisma generate
 *   npx prisma db push
 */

"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const fs   = require("fs");
const path = require("path");
const { parse } = require("csv-parse/sync");
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg }     = require("@prisma/adapter-pg");

// ── Prisma client ─────────────────────────────────────────────────────────────
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// ── Canonical interest tags (sourced from Welcome.csv categories) ─────────────
const CANONICAL_TAGS = [
  { slug: "architecture-real-estate", label: "Architecture & Real Estate", category: "Industry"  },
  { slug: "art-culture",              label: "Art & Culture",               category: "Lifestyle" },
  { slug: "automotive",               label: "Automotive",                  category: "Lifestyle" },
  { slug: "education",                label: "Education",                   category: "Social"    },
  { slug: "fashion",                  label: "Fashion",                     category: "Lifestyle" },
  { slug: "finance-business",         label: "Finance & Business",          category: "Industry"  },
  { slug: "food-drinks",              label: "Food & Drinks",               category: "Lifestyle" },
  { slug: "games-gaming",             label: "Games & Gaming",              category: "Lifestyle" },
  { slug: "healthcare",               label: "Healthcare",                  category: "Social"    },
  { slug: "media-entertainment",      label: "Media & Entertainment",       category: "Industry"  },
  { slug: "music",                    label: "Music",                       category: "Lifestyle" },
  { slug: "non-profits",              label: "Non-Profits",                 category: "Social"    },
  { slug: "personal-care-grooming",   label: "Personal Care & Grooming",    category: "Lifestyle" },
  { slug: "science",                  label: "Science",                     category: "Industry"  },
  { slug: "spirits-beer-wine",        label: "Spirits, Beer & Wine",        category: "Lifestyle" },
  { slug: "sports-fitness",           label: "Sports & Fitness",            category: "Lifestyle" },
  { slug: "technology",               label: "Technology",                  category: "Industry"  },
  { slug: "other",                    label: "Other / Free Text",           category: "Other"     },
];

// Map from various CSV label spellings → canonical slug
const LABEL_TO_SLUG = new Map([
  ["architecture & real estate", "architecture-real-estate"],
  ["art & culture",              "art-culture"],
  ["automotive",                 "automotive"],
  ["education",                  "education"],
  ["fashion",                    "fashion"],
  ["finance & business",         "finance-business"],
  ["food & drinks",              "food-drinks"],
  ["games & gaming",             "games-gaming"],
  ["healthcare",                 "healthcare"],
  ["health & wellness",          "healthcare"],   // Office Visit alias
  ["media & entertainment",      "media-entertainment"],
  ["music",                      "music"],
  ["non-profits",                "non-profits"],
  ["personal care & grooming",   "personal-care-grooming"],
  ["science",                    "science"],
  ["spirits, beer & wine",       "spirits-beer-wine"],
  ["spirit, beer & wine",        "spirits-beer-wine"],  // Office Visit typo
  ["sports & fitness",           "sports-fitness"],
  ["technology",                 "technology"],
]);

// ── Name normalisation ────────────────────────────────────────────────────────
function normalizeName(name) {
  return (name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")         // strip accent diacritics
    .replace(/\b(jr\.?|sr\.?|ii|iii|iv)\b/g, "") // strip name suffixes
    .replace(/[^a-z\s'-]/g, "")             // keep only letters, spaces, hyphens, apostrophes
    .replace(/\s+/g, " ")
    .trim();
}

// Test entries to skip outright
const SKIP_NAMES = new Set(["test", "test 2", "keisha", "c"]);
function shouldSkip(rawName) {
  const n = (rawName || "").trim();
  if (!n) return true;
  if (SKIP_NAMES.has(n.toLowerCase())) return true;
  if (/^test\s*\d*$/i.test(n)) return true;
  return false;
}

// ── Player matching ───────────────────────────────────────────────────────────
// Returns matched player or null.
function matchPlayer(rawSurveyName, playerByNorm) {
  const norm = normalizeName(rawSurveyName);
  if (!norm) return null;

  // 1. Exact normalised match
  if (playerByNorm.has(norm)) return playerByNorm.get(norm);

  // 2. Token-subset: every token in the survey name appears in the DB name
  const surveyTokens = norm.split(" ").filter(Boolean);
  if (surveyTokens.length === 0) return null;

  const candidates = [];
  for (const [dbNorm, player] of playerByNorm) {
    const dbTokens = dbNorm.split(" ").filter(Boolean);
    if (surveyTokens.every((t) => dbTokens.includes(t))) {
      // score = fraction of DB tokens matched (higher = more specific)
      candidates.push({ player, score: surveyTokens.length / dbTokens.length });
    }
  }

  if (candidates.length === 1) return candidates[0].player;
  if (candidates.length > 1) {
    candidates.sort((a, b) => b.score - a.score);
    if (candidates[0].score > candidates[1].score) return candidates[0].player;
    // Genuinely ambiguous
    console.warn(`  [ambiguous] "${rawSurveyName}" matched ${candidates.length} players — skipping`);
    return null;
  }

  return null;
}

// ── Parse the category column triplets from the sub-header row ────────────────
// Welcome.csv sub-header values look like:
//   "🏠 Architecture & Real Estate - Love"
//   "🏠 Architecture & Real Estate - Like"
//   "🏠 Architecture & Real Estate - No, Thanks"
function parseCategoryColumns(subHeaders) {
  // slug → { loveIdx, likeIdx, noIdx }
  const catCols = new Map();

  for (let i = 0; i < subHeaders.length; i++) {
    const h = (subHeaders[i] || "").trim();

    const loveM    = h.match(/^(.+?)\s*-\s*Love$/i);
    const likeM    = h.match(/^(.+?)\s*-\s*Like$/i);
    const noM      = h.match(/^(.+?)\s*-\s*No,?\s*Thanks$/i);

    const m = loveM || likeM || noM;
    if (!m) continue;

    // Strip leading emoji / non-alpha characters to get the plain category label
    const rawLabel = m[1].replace(/^[^A-Za-z]+/, "").trim();
    const slug = LABEL_TO_SLUG.get(rawLabel.toLowerCase());
    if (!slug) {
      console.warn(`  [warn] Unrecognised category header: "${rawLabel}" (col ${i})`);
      continue;
    }

    if (!catCols.has(slug)) catCols.set(slug, { loveIdx: -1, likeIdx: -1, noIdx: -1 });
    const entry = catCols.get(slug);
    if (loveM) entry.loveIdx = i;
    if (likeM) entry.likeIdx = i;
    if (noM)   entry.noIdx   = i;
  }

  return catCols;
}

// ── Determine strength from a row's three category columns ───────────────────
function getStrength(row, loveIdx, likeIdx, noIdx) {
  const love = loveIdx >= 0 ? (row[loveIdx] || "").trim() : "";
  const like = likeIdx >= 0 ? (row[likeIdx] || "").trim() : "";
  const no   = noIdx   >= 0 ? (row[noIdx]   || "").trim() : "";
  if (love) return { strength: "love",      score: 3 };
  if (like) return { strength: "like",      score: 2 };
  if (no)   return { strength: "no_thanks", score: 0 };
  return null; // not filled in — skip
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const csvPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, "..", "data", "Welcome.csv");

  if (!fs.existsSync(csvPath)) {
    console.error(`\n❌ CSV file not found: ${csvPath}`);
    console.error("   Copy your Welcome.csv into the data/ folder first, or pass the path as an argument.");
    process.exit(1);
  }

  console.log(`\n📂 Reading ${csvPath} …`);
  const raw  = fs.readFileSync(csvPath, "utf8");
  const rows = parse(raw, {
    relaxQuotes:       true,
    relaxColumnCount:  true,
    skipEmptyLines:    false,
  });

  if (rows.length < 3) {
    console.error("CSV has fewer than 3 rows — expected: header row 1, header row 2, then data.");
    process.exit(1);
  }

  // SurveyMonkey two-row header format
  const subHeaders = rows[1];  // sub-option labels
  const dataRows   = rows.slice(2);

  // Column 9 = "Enter your name below." (sub-header = "Open-Ended Response")
  const NAME_COL = 9;

  // Free-text column = last "Open-Ended Response" in sub-headers
  let FREE_TEXT_COL = -1;
  for (let i = subHeaders.length - 1; i >= 0; i--) {
    if ((subHeaders[i] || "").trim() === "Open-Ended Response") {
      FREE_TEXT_COL = i;
      break;
    }
  }

  console.log(`  Name column:      ${NAME_COL}`);
  console.log(`  Free-text column: ${FREE_TEXT_COL}`);

  const catCols = parseCategoryColumns(subHeaders);
  console.log(`  Found ${catCols.size} interest categories in headers`);

  // ── Load all DB players once ────────────────────────────────────────────────
  console.log("\n🏀 Loading players from DB …");
  const allPlayers  = await prisma.player.findMany({ select: { id: true, name: true, nbaPersonId: true } });
  const playerByNorm = new Map();
  for (const p of allPlayers) playerByNorm.set(normalizeName(p.name), p);
  console.log(`   ${allPlayers.length} players loaded`);

  // ── Upsert canonical tags ───────────────────────────────────────────────────
  console.log("\n🏷  Upserting canonical interest tags …");
  const tagBySlug = new Map();
  for (const def of CANONICAL_TAGS) {
    const tag = await prisma.interestTag.upsert({
      where:  { slug: def.slug },
      create: def,
      update: { label: def.label, category: def.category },
    });
    tagBySlug.set(tag.slug, tag);
  }
  console.log(`   ${tagBySlug.size} tags ready`);

  // ── Process survey rows ─────────────────────────────────────────────────────
  console.log("\n📊 Processing survey rows …\n");

  let matched = 0, skipped = 0, unmatched = 0, interestRows = 0;
  const unmatchedNames = [];

  for (const row of dataRows) {
    const rawName = (row[NAME_COL] || "").trim();

    if (shouldSkip(rawName)) {
      console.log(`  [SKIP]     "${rawName}"`);
      skipped++;
      continue;
    }

    const player = matchPlayer(rawName, playerByNorm);
    if (!player) {
      console.log(`  [NO MATCH] "${rawName}"`);
      unmatched++;
      unmatchedNames.push(rawName);
      continue;
    }

    console.log(`  [MATCH]    "${rawName}" → ${player.name}`);
    matched++;

    // ── Category Love/Like/No Thanks ─────────────────────────────────────────
    for (const [slug, cols] of catCols) {
      const result = getStrength(row, cols.loveIdx, cols.likeIdx, cols.noIdx);
      if (!result) continue; // no selection made

      const tag = tagBySlug.get(slug);
      if (!tag) continue;

      await prisma.playerInterest.upsert({
        where: {
          playerId_tagId_source: { playerId: player.id, tagId: tag.id, source: "survey" },
        },
        create: {
          playerId: player.id,
          tagId:    tag.id,
          source:   "survey",
          strength: result.strength,
          score:    result.score,
          notes:    null,
        },
        update: {
          strength: result.strength,
          score:    result.score,
        },
      });
      interestRows++;
    }

    // ── Free-text "surprised" interest → stored as notes on "other" tag ──────
    const freeText = FREE_TEXT_COL >= 0 ? (row[FREE_TEXT_COL] || "").trim() : "";
    if (freeText) {
      const otherTag = tagBySlug.get("other");
      await prisma.playerInterest.upsert({
        where: {
          playerId_tagId_source: { playerId: player.id, tagId: otherTag.id, source: "survey_notes" },
        },
        create: {
          playerId: player.id,
          tagId:    otherTag.id,
          source:   "survey_notes",
          strength: null,
          score:    1,
          notes:    freeText,
        },
        update: { notes: freeText },
      });
      interestRows++;
    }
  }

  // ── Write unmatched CSV ─────────────────────────────────────────────────────
  const dataDir       = path.join(__dirname, "..", "data");
  const unmatchedPath = path.join(dataDir, "unmatched_welcome.csv");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(
    unmatchedPath,
    "name\n" + unmatchedNames.map((n) => `"${n.replace(/"/g, '""')}"`).join("\n") + "\n"
  );

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log("\n────────────────────────────────");
  console.log("✅ Import complete");
  console.log(`   Matched:       ${matched}`);
  console.log(`   Unmatched:     ${unmatched}  →  data/unmatched_welcome.csv`);
  console.log(`   Skipped:       ${skipped}`);
  console.log(`   Interest rows: ${interestRows}`);
  console.log("────────────────────────────────\n");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
