import { useRouter } from "next/router";
import Link from "next/link";
import { useState, useEffect } from "react";

export default function PlayerPage() {
  const router = useRouter();
  const { id } = router.query;
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/player/${id}`)
      .then((res) => {
        if (!res.ok) return res.json().then((e) => Promise.reject(e));
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setPlayer(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "Failed to load player");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (router.isFallback || !id) {
    return (
      <div className="page">
        <div className="state">Loading…</div>
        <style jsx>{`
          .page { min-height: 100vh; background: var(--color-page-bg-subtle); padding: 2rem; }
          .state { text-align: center; color: var(--color-muted); }
        `}</style>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="header">
        <Link href="/" className="back">
          ← All players
        </Link>
      </header>

      <main className="main">
        {loading && (
          <div className="state state-loading" role="status">
            Loading player…
          </div>
        )}

        {error && (
          <div className="state state-error" role="alert">
            {error}
          </div>
        )}

        {!loading && !error && player && (
          <div className="profile">
            <img
              src={player.headshot}
              alt=""
              className="profile-img"
              width="260"
              height="190"
            />
            <div className="profile-info">
              <h1 className="profile-name">{player.name}</h1>
              <dl className="profile-meta">
                <dt>Team</dt>
                <dd>{player.team || "—"}</dd>
                <dt>Position</dt>
                <dd>{player.position || "—"}</dd>
              </dl>
              <section className="social-section" aria-label="Social media">
                <h2 className="social-title">Social media</h2>
                {player.socialMedia ? (
                  <>
                    <dl className="social-stats">
                      <div className="social-row">
                        <dt>IG username</dt>
                        <dd>{player.socialMedia.igUsername || "—"}</dd>
                      </div>
                      <div className="social-row">
                        <dt>Followers</dt>
                        <dd>{player.socialMedia.followers ?? "—"}</dd>
                      </div>
                      <div className="social-row">
                        <dt>Following</dt>
                        <dd>{player.socialMedia.following ?? "—"}</dd>
                      </div>
                      <div className="social-row">
                        <dt>Engagement rate</dt>
                        <dd>{player.socialMedia.engagementRate ?? "—"}</dd>
                      </div>
                      <div className="social-row">
                        <dt>Avg likes</dt>
                        <dd>{player.socialMedia.avgLikes ?? "—"}</dd>
                      </div>
                      <div className="social-row">
                        <dt>Avg comments</dt>
                        <dd>{player.socialMedia.avgComments ?? "—"}</dd>
                      </div>
                    </dl>
                    {player.socialMedia.instagramUpdatedAt && (
                      <p className="social-updated">
                        Last updated:{" "}
                        {new Date(player.socialMedia.instagramUpdatedAt).toLocaleString()}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="social-placeholder">
                    No Instagram data for this player. Add their username to the database and run the scraper.
                  </p>
                )}
              </section>

              <section className="partnerships-section" aria-label="Past partnerships">
                <h2 className="partnerships-title">Past Partnerships</h2>
                {player.partnerships && player.partnerships.length > 0 ? (
                  <ul className="partnerships-list">
                    {player.partnerships.map((p) => (
                      <li key={p.id} className="partnership-card">
                        <div className="partnership-brand">{p.brand}</div>
                        <dl className="partnership-details">
                          <div className="partnership-row">
                            <dt>Dates</dt>
                            <dd>{p.dates || "—"}</dd>
                          </div>
                          <div className="partnership-row">
                            <dt>Type of Activation</dt>
                            <dd>{p.activationType || "—"}</dd>
                          </div>
                          {p.distribution && (
                            <div className="partnership-row">
                              <dt>Distribution</dt>
                              <dd>{p.distribution}</dd>
                            </div>
                          )}
                          {p.additionalNotes && (
                            <div className="partnership-row">
                              <dt>Additional Notes</dt>
                              <dd>{p.additionalNotes}</dd>
                            </div>
                          )}
                          {p.playerFee && (
                            <div className="partnership-row">
                              <dt>Player Fee</dt>
                              <dd>{p.playerFee}</dd>
                            </div>
                          )}
                        </dl>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="partnerships-empty">No partnerships yet.</p>
                )}
              </section>

              <div className="profile-actions">
                <Link href={`/player/${player.id}/review`} className="review-link">
                  Player Review →
                </Link>
              </div>
            </div>
          </div>
        )}
      </main>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: var(--color-page-bg-subtle);
          color: var(--nbpa-text-on-light);
        }
        .header {
          background: var(--color-page-bg);
          padding: 1rem 1.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .back {
          color: var(--nbpa-gold);
          text-decoration: none;
          font-size: 0.95rem;
        }
        .back:hover {
          text-decoration: underline;
        }
        .main {
          padding: 1.5rem;
          max-width: 56rem;
          margin: 0 auto;
        }
        .state {
          text-align: center;
          padding: 3rem 1rem;
          color: var(--color-muted);
        }
        .state-loading {
          font-style: italic;
        }
        .state-error {
          color: var(--color-error);
        }
        .profile {
          display: flex;
          flex-wrap: wrap;
          gap: 1.5rem;
          align-items: flex-start;
          background: var(--color-page-bg);
          padding: 1.5rem;
          border-radius: 8px;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        .profile-img {
          width: 260px;
          height: auto;
          aspect-ratio: 260 / 190;
          object-fit: cover;
          border-radius: 6px;
          background: var(--color-border);
        }
        .profile-info {
          flex: 1;
          min-width: 200px;
        }
        .profile-name {
          margin: 0 0 1rem 0;
          font-size: 1.75rem;
          font-weight: 800;
        }
        .profile-meta {
          margin: 0 0 1.5rem 0;
          display: grid;
          grid-template-columns: auto 1fr;
          gap: 0.25rem 1rem;
        }
        .profile-meta dt {
          margin: 0;
          color: var(--color-muted);
          font-weight: 500;
        }
        .profile-meta dd {
          margin: 0;
        }
        .social-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-border);
        }
        .social-title {
          margin: 0 0 0.75rem 0;
          font-size: 1.1rem;
          font-weight: 800;
        }
        .social-stats {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .social-row {
          display: grid;
          grid-template-columns: 10rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
        }
        .social-row dt {
          margin: 0;
          color: var(--color-muted);
          font-weight: 500;
          font-size: 0.9rem;
        }
        .social-row dd {
          margin: 0;
          font-size: 0.95rem;
        }
        .social-updated {
          margin: 0.75rem 0 0 0;
          font-size: 0.8rem;
          color: var(--color-muted-light);
        }
        .social-placeholder {
          margin: 0;
          color: var(--color-muted-light);
          font-size: 0.9rem;
        }
        .partnerships-section {
          margin-top: 1.5rem;
          padding-top: 1.5rem;
          border-top: 1px solid var(--color-border);
        }
        .partnerships-title {
          margin: 0 0 0.75rem 0;
          font-size: 1.1rem;
          font-weight: 800;
        }
        .partnerships-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }
        .partnership-card {
          background: var(--color-page-bg-alt);
          border-radius: 6px;
          padding: 1rem;
          border: 1px solid var(--color-border);
        }
        .partnership-brand {
          font-weight: 600;
          font-size: 1rem;
          margin-bottom: 0.5rem;
          color: var(--nbpa-text-on-light);
        }
        .partnership-details {
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }
        .partnership-row {
          display: grid;
          grid-template-columns: 10rem 1fr;
          gap: 0.5rem;
          align-items: baseline;
        }
        .partnership-row dt {
          margin: 0;
          color: var(--color-muted);
          font-weight: 500;
          font-size: 0.85rem;
        }
        .partnership-row dd {
          margin: 0;
          font-size: 0.9rem;
        }
        .partnerships-empty {
          margin: 0;
          color: var(--color-muted-light);
          font-size: 0.9rem;
        }
        .profile-actions {
          margin-top: 1.5rem;
          padding-top: 1rem;
          border-top: 1px solid var(--color-border);
        }
        .review-link {
          display: inline-block;
          color: var(--nbpa-gold);
          text-decoration: none;
          font-weight: 500;
          font-size: 0.95rem;
        }
        .review-link:hover {
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}
