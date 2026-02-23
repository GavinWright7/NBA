import { prisma } from "../../../lib/db";
const { scrapeInstagramProfile } = require("../../../lib/instagram");

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const players = await prisma.player.findMany({
      where: { instagram: { not: null } },
      select: { id: true, name: true, instagram: true },
    });
    let updated = 0;
    for (const player of players) {
      const username = player.instagram?.trim();
      if (!username) continue;
      const data = await scrapeInstagramProfile(username);
      if (data) {
        await prisma.player.update({
          where: { id: player.id },
          data: {
            followers: data.followers ?? undefined,
            following: data.following ?? undefined,
            instagramUpdatedAt: new Date(),
          },
        });
        updated++;
      }
      await delay(1500);
    }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      ok: true,
      playersChecked: players.length,
      playersUpdated: updated,
    });
  } catch (err) {
    console.error("[cron/instagram]", err);
    return res.status(500).json({ error: err.message });
  }
}
