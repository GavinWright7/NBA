import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

const FOLLOWERS_DEBOUNCE_MS = 300;

function parseFollowersInput(str) {
  if (str == null || typeof str !== "string") return null;
  const t = str.trim();
  if (t === "") return null;
  const m = t.match(/^([\d.]+)\s*([kmb])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1], 10);
  if (Number.isNaN(n) || n < 0) return null;
  const suffix = (m[2] || "").toLowerCase();
  if (suffix === "k") n *= 1e3;
  else if (suffix === "m") n *= 1e6;
  else if (suffix === "b") n *= 1e9;
  return Math.round(n);
}

export default function Home() {
  const [data, setData] = useState(null);
  const [facets, setFacets] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [team, setTeam] = useState("");
  const [position, setPosition] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [maxFollowers, setMaxFollowers] = useState("");
  const [minFollowersQuery, setMinFollowersQuery] = useState("");
  const [maxFollowersQuery, setMaxFollowersQuery] = useState("");
  const followersDebounceRef = useRef(null);

  const fetchPlayers = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("q", search.trim());
    if (team) params.set("team", team);
    if (position) params.set("position", position);
    const minF = parseFollowersInput(minFollowersQuery);
    const maxF = parseFollowersInput(maxFollowersQuery);
    if (minF != null) params.set("minFollowers", String(minF));
    if (maxF != null) params.set("maxFollowers", String(maxF));
    const isFullList =
      !search.trim() &&
      !team &&
      !position &&
      minF == null &&
      maxF == null;
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
          const skip = (v) =>
            v == null ||
            (typeof v === "string" && (v.trim() === "" || /^\(not\s+available\)$/i.test(v.trim())));
          const teams = [...new Set(json.players.map((p) => p.team).filter((t) => !skip(t)))].sort();
          const positions = [...new Set(json.players.map((p) => p.position).filter((p) => !skip(p)))].sort();
          setFacets((prev) => ({
            teams,
            positions,
          }));
        }
      })
      .catch((err) => {
        setError(err.message || "Failed to load players");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [search, team, position, minFollowersQuery, maxFollowersQuery]);

  useEffect(() => {
    if (followersDebounceRef.current) clearTimeout(followersDebounceRef.current);
    followersDebounceRef.current = setTimeout(() => {
      setMinFollowersQuery(minFollowers);
      setMaxFollowersQuery(maxFollowers);
      followersDebounceRef.current = null;
    }, FOLLOWERS_DEBOUNCE_MS);
    return () => {
      if (followersDebounceRef.current) clearTimeout(followersDebounceRef.current);
    };
  }, [minFollowers, maxFollowers]);

  useEffect(() => {
    fetch("/api/players/facets")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Facets failed"))))
      .then((f) => {
        setFacets((prev) => ({
          teams: f.teams?.length ? f.teams : prev?.teams ?? [],
          positions: f.positions?.length ? f.positions : prev?.positions ?? [],
        }));
      })
      .catch(() => setFacets({ teams: [], positions: [] }));
  }, []);

  useEffect(() => {
    fetchPlayers();
  }, [fetchPlayers]);

  const players = data?.players ?? [];

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
          <input
            type="text"
            inputMode="numeric"
            className="filter-input"
            placeholder="Min followers (e.g. 10k, 20M)"
            value={minFollowers}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*[kmb]?$/i.test(v)) setMinFollowers(v);
            }}
            aria-label="Min followers"
          />
          <input
            type="text"
            inputMode="numeric"
            className="filter-input"
            placeholder="Max followers (e.g. 10k, 20M)"
            value={maxFollowers}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "" || /^\d*\.?\d*[kmb]?$/i.test(v)) setMaxFollowers(v);
            }}
            aria-label="Max followers"
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
          background: var(--color-page-bg-list);
          color: var(--nbpa-text-on-dark);
        }
        .header {
          background: var(--nbpa-header-bg);
          padding: 1rem 1.5rem 1.25rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
        }
        .title {
          margin: 0 0 0.25rem 0;
          font-size: 1.5rem;
          font-weight: 800;
          color: var(--nbpa-text-on-dark);
        }
        .count {
          margin: 0 0 1rem 0;
          font-size: 0.9rem;
          color: rgba(255, 255, 255, 0.85);
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
          background: var(--color-page-bg-list);
          padding-bottom: 0.25rem;
        }
        .search {
          width: 100%;
          max-width: 20rem;
          padding: 0.6rem 0.75rem;
          font-size: 1rem;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 6px;
          outline: none;
          background: rgba(255, 255, 255, 0.08);
          color: var(--nbpa-text-on-dark);
        }
        .search::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }
        .search:focus {
          border-color: var(--nbpa-gold);
          box-shadow: 0 0 0 2px rgba(170, 145, 90, 0.25);
        }
        .filter-select,
        .filter-input {
          padding: 0.5rem 0.6rem;
          font-size: 0.9rem;
          border: 1px solid rgba(255, 255, 255, 0.25);
          border-radius: 6px;
          background: rgba(255, 255, 255, 0.08);
          color: var(--nbpa-text-on-dark);
          min-width: 6rem;
        }
        .filter-input {
          width: 7rem;
        }
        .filter-input::-webkit-outer-spin-button,
        .filter-input::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        .main {
          padding: 1.5rem;
        }
        .state {
          text-align: center;
          padding: 3rem 1rem;
          color: rgba(255, 255, 255, 0.8);
        }
        .state-loading {
          font-style: italic;
        }
        .state-error {
          color: #f0a0a0;
        }
        .state-empty {
          color: rgba(255, 255, 255, 0.7);
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
          background: var(--color-page-bg);
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
          transition: box-shadow 0.2s, transform 0.2s;
          height: 100%;
          display: flex;
          flex-direction: column;
        }
        .card:hover {
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
          transform: translateY(-2px);
        }
        .card-img {
          width: 100%;
          height: auto;
          aspect-ratio: 260 / 190;
          object-fit: cover;
          background: var(--color-border);
        }
        .card-body {
          padding: 0.75rem;
          flex: 1;
        }
        .card-name {
          margin: 0 0 0.25rem 0;
          font-size: 1rem;
          font-weight: 800;
          line-height: 1.3;
          color: var(--nbpa-text-on-light);
        }
        .card-meta {
          margin: 0;
          font-size: 0.75rem;
          color: var(--color-muted);
        }
      `}</style>
    </div>
  );
}
