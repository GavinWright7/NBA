import { prisma } from "../../lib/db";

const HEADSHOT_BASE = "https://cdn.nba.com/headshots/nba/latest/1040x760";

const SKIP_VALUES = new Set(["(not available)", "not available", "—", ""]);
const ALLOWED_ORDER_BY = new Set(["name", "team", "position", "followers", "following", "heightInches", "createdAt"]);

function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

function skipValue(val) {
  if (val == null) return true;
  const s = String(val).trim();
  return s === "" || SKIP_VALUES.has(s) || /^\(not\s+available\)$/i.test(s);
}

export default async function handler(req, res) {
  try {
    const { q, team, position, minHeight, maxHeight, minFollowers, maxFollowers, sort } = req.query;
    const where = {};
    if (q != null && String(q).trim() !== "" && !skipValue(q)) {
      where.name = { contains: String(q).trim(), mode: "insensitive" };
    }
    if (team != null && !skipValue(team)) {
      const t = String(team).trim();
      where.team = t;
    }
    if (position != null && !skipValue(position)) {
      const p = String(position).trim();
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

    const orderByKey =
      sort != null && String(sort).trim() !== "" && ALLOWED_ORDER_BY.has(String(sort).trim())
        ? String(sort).trim()
        : "name";
    const players = await prisma.player.findMany({
      where,
      orderBy: { [orderByKey]: "asc" },
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
    res.setHeader("Cache-Control", "no-store");
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
