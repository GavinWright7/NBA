require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { scrapeInstagramProfile } = require("../lib/instagram");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const players = await prisma.player.findMany({
    where: { instagram: { not: null } },
    select: { id: true, nbaPersonId: true, name: true, instagram: true },
  });
  if (players.length === 0) {
    console.log("No players with instagram username set. Add usernames to Player.instagram (e.g. in Prisma Studio or seed).");
    return;
  }
  console.log(`Scraping Instagram for ${players.length} player(s)...`);
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
      console.log(`${player.name} (@${username}): followers=${data.followers ?? "—"} following=${data.following ?? "—"}`);
    } else {
      console.warn(`${player.name} (@${username}): scrape failed or blocked`);
    }
    await delay(2000);
  }
  console.log("Done.");
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
