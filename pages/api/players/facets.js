import { prisma } from "../../../lib/db";

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
    const positionValues = positions.map((r) => r.position).filter(Boolean);
    const positionsGandFOnly = positionValues.filter(
      (p) => p.toUpperCase() !== "C" && !/^center$/i.test(p)
    );
    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.status(200).json({
      teams: teams.map((r) => r.team).filter(Boolean),
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
