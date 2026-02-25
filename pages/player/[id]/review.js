import { useRouter } from "next/router";
import Link from "next/link";
import { useState, useEffect } from "react";

export default function PlayerReviewPage() {
  const router = useRouter();
  const { id } = router.query;
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    fetch(`/api/player/${id}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("Not found"))))
      .then((data) => {
        if (!cancelled) setPlayer(data);
      })
      .catch(() => {
        if (!cancelled) setPlayer(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="page">
      <header className="header">
        <Link href={`/player/${id}`} className="back">
          ← Back to player
        </Link>
      </header>

      <main className="main">
        {loading && (
          <div className="state">Loading…</div>
        )}

        {!loading && (
          <>
            <h1 className="title">
              Player Review{player ? ` · ${player.name}` : ""}
            </h1>
            <p className="subtitle">
              Template only. Review data not yet stored in database.
            </p>

            <section className="review-section">
              <h2 className="section-title">Overview</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">—</p>
              </div>
            </section>

            <section className="review-section">
              <h2 className="section-title">Brand Fit</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">—</p>
              </div>
            </section>

            <section className="review-section">
              <h2 className="section-title">Audience</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">—</p>
              </div>
            </section>

            <section className="review-section">
              <h2 className="section-title">Past Activations</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">—</p>
              </div>
            </section>

            <section className="review-section">
              <h2 className="section-title">Notes</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">—</p>
              </div>
            </section>
          </>
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
          padding: 1rem 1.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
        }
        .back {
          color: #0066cc;
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
          padding: 3rem;
          color: #555;
        }
        .title {
          margin: 0 0 0.25rem 0;
          font-size: 1.5rem;
          font-weight: 700;
        }
        .subtitle {
          margin: 0 0 1.5rem 0;
          font-size: 0.9rem;
          color: #666;
        }
        .review-section {
          background: #fff;
          border-radius: 8px;
          padding: 1.25rem;
          margin-bottom: 1rem;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        .section-title {
          margin: 0 0 0.75rem 0;
          font-size: 1.1rem;
          font-weight: 600;
        }
        .placeholder-block {
          min-height: 2rem;
        }
        .placeholder-text {
          margin: 0;
          color: #888;
          font-size: 0.95rem;
        }
      `}</style>
    </div>
  );
}
