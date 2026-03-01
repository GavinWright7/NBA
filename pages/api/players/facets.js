import { prisma } from "../../../lib/db";

const SKIP_VALUES = new Set(["(not available)", "not available", "—"]);

function validFacetValue(v) {
  if (v == null || typeof v !== "string") return false;
  const s = v.trim();
  return s !== "" && !SKIP_VALUES.has(s) && !/^\(not\s+available\)$/i.test(s);
}

export default async function handler(req, res) {
  try {
    const [teams, positions, heightRange] = await Promise.all([
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
    ]);
    const teamValues = teams.map((r) => r.team).filter(validFacetValue);
    const positionValues = positions.map((r) => r.position).filter(validFacetValue);
    const positionsGandFOnly = positionValues.filter(
      (p) => p.toUpperCase() !== "C" && !/^center$/i.test(p)
    );
    res.setHeader(
      "Cache-Control",
      "no-store"
    );
    return res.status(200).json({
      teams: teamValues,
      positions: positionsGandFOnly,
      minHeightInches: heightRange._min.heightInches ?? 72,
      maxHeightInches: heightRange._max.heightInches ?? 96,
    });
  } catch (err) {
    console.error("[api/players/facets]", err);
    return res.status(500).json({
      error: "Server error while fetching facets",
      message: err.message,
    });
  }
}
