import { prisma } from "../../lib/db";

const HEADSHOT_BASE = "https://cdn.nba.com/headshots/nba/latest/1040x760";

function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

export default async function handler(req, res) {
  try {
    const { q, team, position, minHeight, maxHeight, minFollowers, maxFollowers } = req.query;
    const where = {};
    if (q != null && String(q).trim() !== "") {
      where.name = { contains: String(q).trim(), mode: "insensitive" };
    }
    if (team != null && String(team).trim() !== "") {
      where.team = String(team).trim();
    }
    if (position != null && String(position).trim() !== "") {
      const p = String(position).trim();
      // Match position (e.g. "Guard", "Forward", "Center") or positionNorm (G/F/C)
      where.OR = [
        { position: { equals: p, mode: "insensitive" } },
        { positionNorm: p.toUpperCase() },
      ];
    }
    if (minHeight != null && minHeight !== "") {
      const n = parseInt(String(minHeight), 10);
      if (!Number.isNaN(n)) {
        where.heightInches = where.heightInches || {};
        where.heightInches.gte = n;
      }
    }
    if (maxHeight != null && maxHeight !== "") {
      const n = parseInt(String(maxHeight), 10);
      if (!Number.isNaN(n)) {
        where.heightInches = where.heightInches || {};
        where.heightInches.lte = n;
      }
    }
    const minF =
      minFollowers != null && String(minFollowers).trim() !== ""
        ? parseInt(String(minFollowers).trim(), 10)
        : null;
    const maxF =
      maxFollowers != null && String(maxFollowers).trim() !== ""
        ? parseInt(String(maxFollowers).trim(), 10)
        : null;
    if (minF != null && !Number.isNaN(minF) && minF >= 0) {
      where.followers = where.followers || {};
      where.followers.gte = minF;
    }
    if (maxF != null && !Number.isNaN(maxF) && maxF >= 0) {
      where.followers = where.followers || {};
      where.followers.lte = maxF;
    }

    const players = await prisma.player.findMany({
      where,
      orderBy: { name: "asc" },
    });
    const season = getCurrentSeason();
    const list = players.map((p) => ({
      id: p.nbaPersonId,
      name: p.name,
      team: p.team ?? null,
      position: p.position ?? null,
      heightInches: p.heightInches ?? null,
      heightText: p.heightText ?? null,
      headshot: `${HEADSHOT_BASE}/${p.nbaPersonId}.png`,
      instagram: p.instagram ?? null,
      followers: p.followers ?? null,
      following: p.following ?? null,
      postsCount: p.posts ?? null,
      engagementRate: p.engagementRate ?? null,
      avgLikesRecent: p.avgLikes ?? null,
      avgCommentsRecent: p.avgComments ?? null,
      lastFetchedAt: p.igLastCheckedAt?.toISOString?.() ?? p.instagramUpdatedAt?.toISOString?.() ?? null,
    }));
    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.status(200).json({
      season,
      count: list.length,
      players: list,
    });
  } catch (err) {
    console.error("[api/players]", err);
    return res.status(500).json({
      error: "Server error while fetching players",
      message: err.message,
    });
  }
}
