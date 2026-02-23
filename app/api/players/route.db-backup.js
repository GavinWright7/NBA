import { prisma } from "../../../lib/db";

export async function GET() {
  const players = await prisma.player.findMany({
    orderBy: { name: "asc" },
  });
  return Response.json(players);
}
