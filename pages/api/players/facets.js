import { prisma } from "../../../lib/db";

const SKIP_VALUES = new Set(["(not available)", "not available", "—", "(not listed)"]);

function validFacetValue(v) {
  if (v == null || typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && !SKIP_VALUES.has(s) && !/^\(not[\s_]+(available|listed)\)$/i.test(s);
}

export default async function handler(req, res) {
  try {
    const [teams, positions, heightRange, interestTags, partnershipBrands] = await Promise.all([
      prisma.player.findMany({
        where: { team: { not: null } },
        select: { team: true },
        distinct: ["team"],
        orderBy: { team: "asc" },
      }),
      prisma.player.findMany({
        where: { position: { not: null } },
        select: { position: true },
        distinct: ["position"],
        orderBy: { position: "asc" },
      }),
      prisma.player.aggregate({
        _min: { heightInches: true },
        _max: { heightInches: true },
      }),
      prisma.interestTag.findMany({
        where: { slug: { not: "other" } },
        select: { slug: true, label: true, category: true },
        orderBy: [{ category: "asc" }, { label: "asc" }],
      }),
      prisma.playerPartnership.findMany({
        select: { brand: true },
        distinct: ["brand"],
        orderBy: { brand: "asc" },
      }),
    ]);
    const teamValues = teams.map((r) => r.team).filter(validFacetValue);
    const positionValues = positions.map((r) => r.position).filter(validFacetValue);
    const positionsGandFOnly = positionValues.filter(
      (p) => p.toUpperCase() !== "C" && !/^center$/i.test(p)
    );
    res.setHeader("Cache-Control", "no-store");
    const brandValues = partnershipBrands.map((r) => r.brand).filter(validFacetValue);
    return res.status(200).json({
      teams: teamValues,
      positions: positionsGandFOnly,
      minHeightInches: heightRange._min.heightInches ?? 72,
      maxHeightInches: heightRange._max.heightInches ?? 96,
      interestTags,
      partnershipBrands: brandValues,
    });
  } catch (err) {
    console.error("[api/players/facets]", err);
    return res.status(500).json({
      error: "Server error while fetching facets",
      message: err.message,
    });
  }
}
