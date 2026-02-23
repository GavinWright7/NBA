import { prisma } from "../lib/db";

const CDN_HEADSHOT = "https://cdn.nba.com/headshots/nba/latest/1040x760";
const CARD_WIDTH = 260;
const CARD_HEIGHT = 190;

export default async function HomePage() {
  const players = await prisma.player.findMany({
    orderBy: { name: "asc" },
  });
  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.title}>NBA Creator Terminal</h1>
      </header>
      <main style={styles.main}>
        <ul style={styles.grid}>
          {players.map((player) => (
            <li key={player.id} style={styles.cardWrap}>
              <div style={styles.card}>
                <img
                  src={`${CDN_HEADSHOT}/${player.nbaPersonId}.png`}
                  alt=""
                  width={CARD_WIDTH}
                  height={CARD_HEIGHT}
                  loading="lazy"
                  style={styles.cardImg}
                />
                <p style={styles.cardName}>{player.name}</p>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "#f5f5f5",
    color: "#111",
  },
  header: {
    background: "#fff",
    padding: "1rem 1.5rem",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  title: {
    margin: 0,
    fontSize: "1.5rem",
    fontWeight: 700,
  },
  main: {
    padding: "1.5rem",
  },
  grid: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
    gap: "1.25rem",
  },
  cardWrap: {
    margin: 0,
  },
  card: {
    background: "#fff",
    borderRadius: 8,
    overflow: "hidden",
    boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
  },
  cardImg: {
    width: "100%",
    height: "auto",
    aspectRatio: `${CARD_WIDTH} / ${CARD_HEIGHT}`,
    objectFit: "cover",
    display: "block",
  },
  cardName: {
    margin: 0,
    padding: "0.75rem",
    fontSize: "1rem",
    fontWeight: 600,
  },
};
