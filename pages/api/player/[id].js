import { prisma } from "../../../lib/db";

const HEADSHOT_BASE = "https://cdn.nba.com/headshots/nba/latest/1040x760";

function formatCount(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
  return String(n);
}

export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) {
    return res.status(400).json({ error: "Missing player id" });
  }

  try {
    const dbPlayer = await prisma.player.findUnique({
      where: { nbaPersonId: String(id) },
      include: { partnerships: true },
    });

    if (!dbPlayer) {
      return res.status(404).json({ error: "Player not found" });
    }

    const socialMedia = dbPlayer.instagram
      ? {
          igUsername: dbPlayer.instagram.startsWith("@")
            ? dbPlayer.instagram
            : `@${dbPlayer.instagram}`,
          followers: dbPlayer.followers != null ? formatCount(dbPlayer.followers) : null,
          following: dbPlayer.following != null ? formatCount(dbPlayer.following) : null,
          engagementRate: dbPlayer.engagementRate != null ? `${dbPlayer.engagementRate}%` : null,
          avgLikes: dbPlayer.avgLikes != null ? formatCount(dbPlayer.avgLikes) : null,
          avgComments: dbPlayer.avgComments != null ? formatCount(dbPlayer.avgComments) : null,
          instagramUpdatedAt: dbPlayer.instagramUpdatedAt?.toISOString() ?? null,
        }
      : null;

    const partnerships = (dbPlayer.partnerships || []).map((p) => ({
      id: p.id,
      brand: p.brand,
      dates: p.dates,
      activationType: p.activationType,
      distribution: p.distribution ?? null,
      additionalNotes: p.additionalNotes ?? null,
      playerFee: p.playerFee ?? null,
      caliber: p.caliber ?? null,
    }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=60, stale-while-revalidate=300"
    );
    return res.status(200).json({
      id: dbPlayer.nbaPersonId,
      name: dbPlayer.name,
      headshot: `${HEADSHOT_BASE}/${dbPlayer.nbaPersonId}.png`,
      team: dbPlayer.team,
      position: dbPlayer.position,
      heightInches: dbPlayer.heightInches,
      heightText: dbPlayer.heightText,
      socialMedia,
      partnerships,
    });
  } catch (err) {
    console.error("[api/player/[id]]", err);
    return res.status(500).json({
      error: "Server error while fetching player",
      message: err.message,
    });
  }
}
