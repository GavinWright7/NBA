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
      <style jsx global>{`
        html { scroll-behavior: smooth; }
      `}</style>
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
              Report template. Some fields are placeholders until data is available.
            </p>

            {/* Table of Contents */}
            <nav className="toc" aria-label="On this page">
              <h2 className="toc-heading">On this page</h2>
              <ul className="toc-list">
                <li><a href="#profile" className="toc-link">Player Profile</a></li>
                <li><a href="#audience" className="toc-link">Audience</a></li>
                <li><a href="#activations" className="toc-link">Past Activations</a></li>
              </ul>
            </nav>

            {/* 1) Player Profile */}
            <section id="profile" className="review-section profile-section">
              <div className="profile-layout">
                <div className="profile-left">
                  <h2 className="profile-name">
                    {player?.name?.split(" ").map((word, i) => (
                      <span key={i} className={i === 0 ? "name-first" : "name-last"}>{word}</span>
                    )) ?? "—"}
                  </h2>
                  {player?.headshot && (
                    <div className="profile-headshot-wrap">
                      <img src={player.headshot} alt={player.name} className="profile-headshot" />
                    </div>
                  )}
                  <div className="block-header">Personal Stats</div>
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">Age</span>
                      <span className="stat-value">—</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Experience</span>
                      <span className="stat-value">—</span>
                    </div>
                  </div>
                  <div className="divider" />
                  <div className="stats-grid">
                    <div className="stat-item">
                      <span className="stat-label">Team</span>
                      <span className="stat-value">{player?.team ?? "—"}</span>
                    </div>
                    <div className="stat-item">
                      <span className="stat-label">Hometown</span>
                      <span className="stat-value">—</span>
                    </div>
                  </div>
                  <div className="divider" />
                  <div className="stat-item full-width">
                    <span className="stat-label">Position</span>
                    <span className="stat-value">{player?.position ?? "—"}</span>
                  </div>

                  <div className="block-header">Social channels</div>
                  <div className="social-list">
                    {player?.socialMedia ? (
                      <div className="social-row">
                        <span className="social-icon social-ig">IG</span>
                        <a
                          href={`https://instagram.com/${(player.socialMedia.igUsername || "").replace(/^@/, "")}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="social-link"
                        >
                          Link
                        </a>
                        <span className="social-followers">{player.socialMedia.followers ?? "—"}</span>
                        <span className="social-engagement">—</span>
                      </div>
                    ) : (
                      <div className="social-row">
                        <span className="social-icon social-ig">IG</span>
                        <span className="social-link disabled">—</span>
                        <span className="social-followers">—</span>
                        <span className="social-engagement">—</span>
                      </div>
                    )}
                    <div className="social-row">
                      <span className="social-icon social-tw">TW</span>
                      <span className="social-link disabled">—</span>
                      <span className="social-followers">—</span>
                      <span className="social-engagement">—</span>
                    </div>
                    <div className="social-row">
                      <span className="social-icon social-fb">FB</span>
                      <span className="social-link disabled">—</span>
                      <span className="social-followers">—</span>
                      <span className="social-engagement">—</span>
                    </div>
                  </div>
                  <p className="engagement-note">Engagement rate shown when available.</p>
                </div>
                <div className="profile-right">
                  <div className="block-header">Partnerships</div>
                  <div className="narrative-block">
                    <p>He is interested in opportunities that are <strong>Legacy-Making.</strong></p>
                    <p className="muted">They build his personal brand long-term through more involvements.</p>
                  </div>
                  <div className="divider" />
                  <p><strong>He gets excited for opportunities that</strong></p>
                  <p className="pill-row">
                    <span className="pill">Advocate for social justice</span>
                    <span className="pill-divider">|</span>
                    <span className="pill">Support his community</span>
                    <span className="pill-divider">|</span>
                    <span className="pill">Reflect his personal background</span>
                  </p>
                  <div className="divider" />
                  <p><strong>He wants to play an active role in his brand partnerships.</strong></p>

                  <div className="interests-header">His passions and interests include</div>
                  <div className="pills">
                    <span className="pill-tag">FINANCE & BUSINESS</span>
                    <span className="pill-tag">EDUCATION</span>
                    <span className="pill-tag">FASHION</span>
                    <span className="pill-tag">MEDIA & ENTERTAINMENT</span>
                    <span className="pill-tag">NON-PROFITS</span>
                  </div>
                  <div className="divider" />
                  <p><strong>His off-the-court personality is The Connector.</strong></p>
                  <p className="muted">He brings everyone together.</p>
                  <div className="divider" />
                  <p><strong>Most people don&apos;t know</strong></p>
                  <p className="muted italic">&quot;Placeholder quote when we have this data.&quot;</p>
                </div>
              </div>
            </section>

            {/* 2) Audience */}
            <section id="audience" className="review-section audience-section">
              <h2 className="section-title">Audience</h2>
              <div className="placeholder-block">
                <p className="placeholder-text">Audience insights not available yet.</p>
              </div>
            </section>

            {/* 3) Past Activations */}
            <section id="activations" className="review-section activations-section">
              <h2 className="section-title">Past Activations</h2>
              {player?.partnerships?.length > 0 ? (
                <div className="activations-list">
                  {player.partnerships.map((p) => (
                    <div key={p.id} className="activation-card">
                      <div className="activation-row">
                        <span className="activation-label">Brand</span>
                        <span className="activation-value">{p.brand}</span>
                      </div>
                      <div className="activation-row">
                        <span className="activation-label">Dates</span>
                        <span className="activation-value">{p.dates}</span>
                      </div>
                      <div className="activation-row">
                        <span className="activation-label">Activation Type</span>
                        <span className="activation-value">{p.activationType}</span>
                      </div>
                      {p.distribution != null && p.distribution !== "" && (
                        <div className="activation-row">
                          <span className="activation-label">Distribution</span>
                          <span className="activation-value">{p.distribution}</span>
                        </div>
                      )}
                      {p.additionalNotes != null && p.additionalNotes !== "" && (
                        <div className="activation-row">
                          <span className="activation-label">Additional Notes</span>
                          <span className="activation-value">{p.additionalNotes}</span>
                        </div>
                      )}
                      {p.playerFee != null && p.playerFee !== "" && (
                        <div className="activation-row">
                          <span className="activation-label">Player Fee</span>
                          <span className="activation-value">{p.playerFee}</span>
                        </div>
                      )}
                      {p.caliber != null && p.caliber !== "" && (
                        <div className="activation-row">
                          <span className="activation-label">Caliber</span>
                          <span className="activation-value">{p.caliber}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <p>No past activations on record yet.</p>
                </div>
              )}
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
        .back:hover { text-decoration: underline; }
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

        /* TOC */
        .toc {
          background: #fff;
          border-radius: 8px;
          padding: 1rem 1.25rem;
          margin-bottom: 1.5rem;
          box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
        }
        .toc-heading {
          margin: 0 0 0.5rem 0;
          font-size: 0.95rem;
          font-weight: 600;
          color: #333;
        }
        .toc-list {
          margin: 0;
          padding-left: 1.25rem;
          list-style: none;
        }
        .toc-list li { margin: 0.25rem 0; }
        .toc-link {
          color: #0066cc;
          text-decoration: none;
          font-size: 0.95rem;
        }
        .toc-link:hover { text-decoration: underline; }

        /* Section scroll targets for TOC */
        #profile, #audience, #activations {
          scroll-margin-top: 1rem;
        }

        /* Profile section - two columns Danny Green style */
        .profile-section {
          padding: 0;
          overflow: hidden;
        }
        .profile-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 320px;
        }
        @media (max-width: 768px) {
          .profile-layout { grid-template-columns: 1fr; }
        }
        .profile-left {
          background: #8b7355;
          color: #fff;
          padding: 1.5rem;
        }
        .profile-right {
          background: #ede8df;
          color: #1a1a1a;
          padding: 1.5rem;
        }
        .profile-name {
          margin: 0 0 0.75rem 0;
          font-size: clamp(1.5rem, 4vw, 2.25rem);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          line-height: 1.15;
        }
        .profile-name .name-first { display: block; font-size: 1.1em; }
        .profile-name .name-last { display: block; font-size: 0.85em; opacity: 0.95; }
        .profile-headshot-wrap {
          margin: 0 0 1rem 0;
          border-radius: 4px;
          overflow: hidden;
          max-width: 280px;
        }
        .profile-headshot {
          width: 100%;
          height: auto;
          display: block;
          filter: grayscale(1);
        }
        .block-header {
          background: #1a1a1a;
          color: #fff;
          font-size: 0.75rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.4rem 0.6rem;
          margin: 1rem 0 0.6rem 0;
          display: inline-block;
        }
        .profile-right .block-header { background: #1a1a1a; color: #fff; }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.5rem 1rem;
        }
        .stat-item { display: flex; flex-direction: column; gap: 0.15rem; }
        .stat-item.full-width { grid-column: 1 / -1; }
        .stat-label { font-size: 0.8rem; color: rgba(255,255,255,0.85); }
        .profile-right .stat-label { color: #555; }
        .stat-value { font-weight: 700; font-size: 1rem; }
        .profile-right .stat-value { color: #1a1a1a; }
        .divider {
          height: 1px;
          background: rgba(0,0,0,0.15);
          margin: 0.75rem 0;
        }
        .profile-left .divider { background: rgba(255,255,255,0.3); }
        .social-list { margin-top: 0.5rem; }
        .social-row {
          display: grid;
          grid-template-columns: auto auto 1fr auto;
          align-items: center;
          gap: 0.5rem 0.75rem;
          margin-bottom: 0.4rem;
          font-size: 0.9rem;
        }
        .social-icon {
          width: 28px;
          height: 28px;
          border-radius: 4px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.7rem;
          font-weight: 700;
        }
        .social-ig { background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366); color: #fff; }
        .social-tw { background: #1da1f2; color: #fff; }
        .social-fb { background: #1877f2; color: #fff; }
        .social-link { color: #fff; text-decoration: underline; }
        .social-link.disabled { color: rgba(255,255,255,0.7); text-decoration: none; }
        .profile-right .social-link { color: #0066cc; }
        .social-followers, .social-engagement { font-weight: 700; }
        .engagement-note { font-size: 0.75rem; color: rgba(255,255,255,0.8); margin: 0.5rem 0 0 0; }
        .narrative-block p { margin: 0.25rem 0; }
        .narrative-block .muted { color: #555; font-size: 0.95rem; }
        .muted { color: #555; }
        .italic { font-style: italic; }
        .pill-row { margin: 0.35rem 0; font-size: 0.9rem; }
        .pill-divider { margin: 0 0.35rem; color: #999; }
        .interests-header {
          font-weight: 700;
          margin: 0.75rem 0 0.5rem 0;
          font-size: 0.95rem;
        }
        .pills {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin: 0.5rem 0 0 0;
        }
        .pill-tag {
          border: 1px solid #333;
          padding: 0.35rem 0.65rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.02em;
        }

        /* Audience & Activations sections */
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
        .placeholder-block { min-height: 2rem; }
        .placeholder-text { margin: 0; color: #888; font-size: 0.95rem; }

        .activations-list { display: flex; flex-direction: column; gap: 1rem; }
        .activation-card {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 1rem;
          background: #fafafa;
        }
        .activation-row {
          display: grid;
          grid-template-columns: 140px 1fr;
          gap: 0.5rem 1rem;
          margin-bottom: 0.5rem;
          font-size: 0.9rem;
        }
        .activation-row:last-child { margin-bottom: 0; }
        .activation-label { color: #666; font-weight: 500; }
        .activation-value { color: #111; }
        .empty-state {
          padding: 2rem;
          text-align: center;
          color: #888;
          font-size: 0.95rem;
        }
      `}</style>
    </div>
  );
}
