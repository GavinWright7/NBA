import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

function inchToLabel(inches) {
  if (inches == null) return "Any";
  const f = Math.floor(inches / 12);
  const i = inches % 12;
  return `${f}'${i}"`;
}

export default function Home() {
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("");
  const [minHeight, setMinHeight] = useState("");
  const [maxHeight, setMaxHeight] = useState("");

  const fetchPlayers = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (team) params.set("team", team);
    if (position) params.set("position", position);
    if (minHeight !== "") params.set("minHeight", minHeight);
    if (maxHeight !== "") params.set("maxHeight", maxHeight);
    const isFullList = !search.trim() && !team && !position && minHeight === "" && maxHeight === "";
    setLoading(true);
    setError(null);
    fetch(`/api/players?${params.toString()}`)
      .then((res) => {
        if (!res.ok) return res.json().then((e) => Promise.reject(e));
        return res.json();
      })
      .then((json) => {
        setData(json);
        if (isFullList && json.players && json.players.length > 0) {
          const teams = [...new Set(json.players.map((p) => p.team).filter(Boolean))].sort();
          const positions = [...new Set(json.players.map((p) => p.position).filter(Boolean))].sort();
          const heights = json.players.map((p) => p.heightInches).filter((n) => n != null);
          setFacets((prev) => ({
            teams,
            positions,
            minHeightInches: prev?.minHeightInches ?? (heights.length ? Math.min(...heights) : 72),
            maxHeightInches: prev?.maxHeightInches ?? (heights.length ? Math.max(...heights) : 96),
          }));
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load players");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [search, team, position, minHeight, maxHeight]);

  useEffect(() => {
    fetch("/api/players/facets")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Facets failed"))))
      .then((f) => {
        setFacets((prev) => ({
          teams: f.teams?.length ? f.teams : prev?.teams ?? [],
          positions: f.positions?.length ? f.positions : prev?.positions ?? [],
          minHeightInches: f.minHeightInches ?? prev?.minHeightInches ?? 72,
          maxHeightInches: f.maxHeightInches ?? prev?.maxHeightInches ?? 96,
        }));
      })
      .catch(() => setFacets({ teams: [], positions: [], minHeightInches: 72, maxHeightInches: 96 }));
  }, []);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  const players = data?.players ?? [];
  const heightMin = facets?.minHeightInches ?? 72;
  const heightMax = facets?.maxHeightInches ?? 96;
  const heightOptions = [];
  for (let i = heightMin; i <= heightMax; i++) {
    heightOptions.push({ value: i, label: inchToLabel(i) });
  }

  return (
    <div className="page">
      <header className="header">
        <h1 className="title">NBA Players</h1>
        {data && (
          <p className="count">
            {data.season} · {players.length} players
          </p>
        )}
        <div className="filters sticky">
          <input
            type="search"
            className="search"
            placeholder="Search players…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search players"
          />
          <select
            className="filter-select"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            aria-label="Filter by team"
          >
            <option value="">All teams</option>
            {(facets?.teams ?? []).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={position}
            onChange={(e) => setPosition(e.target.value)}
            aria-label="Filter by position"
          >
            <option value="">All positions</option>
            {(facets?.positions ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={minHeight}
            onChange={(e) => setMinHeight(e.target.value)}
            aria-label="Min height"
          >
            <option value="">Min height</option>
            {heightOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="filter-select"
            value={maxHeight}
            onChange={(e) => setMaxHeight(e.target.value)}
            aria-label="Max height"
          >
            <option value="">Max height</option>
            {heightOptions.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
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
            {players.map((player) => (
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
                      <p className="card-meta">
                        {[player.team, player.position, player.heightText].filter(Boolean).join(" · ") || "ID: " + player.id}
                      </p>
                    </div>
                  </article>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {!loading && !error && data && players.length === 0 && (
          <div className="state state-empty">
            No players match the current filters.
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
        .filters {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
          align-items: center;
          margin-top: 0.5rem;
        }
        .filters.sticky {
          position: sticky;
          top: 0;
          z-index: 2;
          background: #fff;
          padding-bottom: 0.25rem;
        }
        .search {
          width: 100%;
          max-width: 20rem;
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
        .filter-select {
          padding: 0.5rem 0.6rem;
          font-size: 0.9rem;
          border: 1px solid #ccc;
          border-radius: 6px;
          background: #fff;
          min-width: 6rem;
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
        .card-meta {
          margin: 0;
          font-size: 0.75rem;
          color: #666;
        }
      `}</style>
    </div>
  );
}
