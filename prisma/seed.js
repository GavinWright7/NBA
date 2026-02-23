require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const players = [
    {
      name: "LeBron James",
      team: "LAL",
      position: "F",
      nbaPersonId: "2544",
      instagram: "kingjames",
    },
    {
      name: "Stephen Curry",
      team: "GSW",
      position: "G",
      nbaPersonId: "201939",
      instagram: "stephencurry30",
    },
  ];
  for (const p of players) {
    await prisma.player.upsert({
      where: { nbaPersonId: p.nbaPersonId },
      update: {},
      create: p,
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
