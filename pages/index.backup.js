import { useState, useEffect } from "react";
import Link from "next/link";

export default function Home() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/players")
      .then((res) => {
        if (!res.ok) return res.json().then((e) => Promise.reject(e));
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || "Failed to load players");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const players = data?.players ?? [];
  const searchLower = search.trim().toLowerCase();
  const filtered =
    searchLower === ""
      ? players
      : players.filter((p) => p.name.toLowerCase().includes(searchLower));

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">NBA Players</h1>
        {data && (
          <p className="count">
            {data.season} · {filtered.length}
            {search.trim() ? ` of ${data.count}` : ""} players
          </p>
        )}
        <div className="search-wrap sticky">
          <input
            type="search"
            className="search"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search players"
          />
        </div>
      </header>

      <main className="main">
        {loading && (
          <div className="state state-loading" role="status">
            Loading players…
          </div>
        )}

        {error && (
          <div className="state state-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <ul className="grid" aria-label="Player list">
            {filtered.map((player) => (
              <li key={player.id} className="card-wrap">
                <Link href={`/player/${player.id}`} className="card-link">
                  <article className="card">
                    <img
                      src={player.headshot}
                      alt=""
                      className="card-img"
                      loading="lazy"
                      width="260"
                      height="190"
                    />
                    <div className="card-body">
                      <h2 className="card-name">{player.name}</h2>
                      <p className="card-id">ID: {player.id}</p>
                    </div>
                  </article>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {!loading && !error && data && filtered.length === 0 && (
          <div className="state state-empty">
            No players match &ldquo;{search}&rdquo;
          </div>
        )}
      </main>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: #f5f5f5;
          color: #111;
        }
        .header {
          background: #fff;
          padding: 1rem 1.5rem 1.25rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .title {
          margin: 0 0 0.25rem 0;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .count {
          margin: 0 0 1rem 0;
          font-size: 0.9rem;
          color: #555;
        }
        .search-wrap {
          margin-top: 0.5rem;
        }
        .search-wrap.sticky {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #fff;
          padding-bottom: 0.25rem;
        }
        .search {
          width: 100%;
          max-width: 24rem;
          padding: 0.6rem 0.75rem;
          font-size: 1rem;
          border: 1px solid #ccc;
          border-radius: 6px;
          outline: none;
        }
        .search:focus {
          border-color: #0066cc;
          box-shadow: 0 0 0 2px rgba(0, 102, 204, 0.2);
        }
        .main {
          padding: 1.5rem;
        }
        .state {
          text-align: center;
          padding: 3rem 1rem;
          color: #555;
        }
        .state-loading {
          font-style: italic;
        }
        .state-error {
          color: #b00;
        }
        .state-empty {
          color: #666;
        }
        .grid {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
          gap: 1.25rem;
        }
        .card-wrap {
          margin: 0;
        }
        .card-link {
          text-decoration: none;
          color: inherit;
          display: block;
          height: 100%;
        }
        .card {
          background: #fff;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
          transition: box-shadow 0.2s, transform 0.2s;
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
          transform: translateY(-2px);
        }
        .card-img {
          width: 100%;
          height: auto;
          aspect-ratio: 260 / 190;
          object-fit: cover;
          background: #e8e8e8;
        }
        .card-body {
          padding: 0.75rem;
          flex: 1;
        }
        .card-name {
          margin: 0 0 0.25rem 0;
          font-size: 1rem;
          font-weight: 600;
          line-height: 1.3;
        }
        .card-id {
          margin: 0;
          font-size: 0.75rem;
          color: #666;
        }
      `}</style>
    </div>
  );
}
