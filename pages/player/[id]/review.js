import { useRouter } from "next/router";
import Link from "next/link";
import { useState, useEffect } from "react";

const TOC_LINKS = [
  { href: "#player-profile", label: "Player Profile" },
  { href: "#audience", label: "Audience" },
  { href: "#past-activations", label: "Past Activations" },
  { href: "#brand-fit", label: "Brand Fit" },
  { href: "#notes", label: "Notes" },
];

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
      <header className="main-header">
        <div className="header-inner">
          <Link href={`/player/${id}`} className="back">
            ← Back to player
          </Link>
        </div>
      </header>

      <main className="main">
        <div className="container">
          {loading && (
            <div className="state">Loading…</div>
          )}

          {!loading && (
            <>
              <h1 className="page-title">
                Player Review{player ? ` · ${player.name}` : ""}
              </h1>

              {/* Sticky Table of Contents */}
              <nav className="review-toc" aria-label="On this page">
                {TOC_LINKS.map(({ href, label }) => (
                  <a key={href} href={href} className="review-toc-link">
                    {label}
                  </a>
                ))}
              </nav>

              {/* 1) Player Profile — Hero */}
              <section id="player-profile" className="player-hero">
                <div className="hero-layout">
                  <div className="hero-left">
                    <h2 className="hero-name">
                      {player?.name?.split(" ").map((word, i) => (
                        <span key={i} className={i === 0 ? "name-first" : "name-last"}>{word}</span>
                      )) || "Player"}
                    </h2>
                    <div className="hero-block">
                      <div className="hero-block-title">Personal Stats</div>
                      <div className="hero-divider" />
                      <div className="stats-grid">
                        <div className="stat-item">
                          <span className="stat-label">Age</span>
                          <span className="stat-value"></span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Experience</span>
                          <span className="stat-value"></span>
                        </div>
                      </div>
                      <div className="hero-divider" />
                      <div className="stats-grid">
                        <div className="stat-item">
                          <span className="stat-label">Team</span>
                          <span className="stat-value">{player?.team || ""}</span>
                        </div>
                        <div className="stat-item">
                          <span className="stat-label">Hometown</span>
                          <span className="stat-value"></span>
                        </div>
                      </div>
                      <div className="hero-divider" />
                      <div className="stat-item full-width">
                        <span className="stat-label">Position</span>
                        <span className="stat-value">{player?.position || ""}</span>
                      </div>
                    </div>
                    <div className="hero-block">
                      <div className="hero-block-title">Fandom</div>
                      <div className="hero-divider" />
                      <p className="hero-muted">Fans are part of his inner circle. Engagement insights when available.</p>
                    </div>
                    <div className="hero-block">
                      <div className="hero-block-title">Social channels</div>
                      <div className="hero-divider" />
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
                            <span className="social-followers">{player.socialMedia.followers ?? ""}</span>
                            <span className="social-engagement">Engagement when available</span>
                          </div>
                        ) : (
                          <div className="social-row">
                            <span className="social-icon social-ig">IG</span>
                            <span className="social-muted">Instagram when available</span>
                          </div>
                        )}
                        <div className="social-row">
                          <span className="social-icon social-tw">TW</span>
                          <span className="social-muted">Twitter when available</span>
                        </div>
                        <div className="social-row">
                          <span className="social-icon social-fb">FB</span>
                          <span className="social-muted">Facebook when available</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="hero-right">
                    {player?.headshot && (
                      <div className="hero-image-wrap">
                        <img src={player.headshot} alt={player.name} className="hero-image" />
                      </div>
                    )}
                    <div className="hero-block light">
                      <div className="hero-block-title gold">Partnerships</div>
                      <div className="hero-divider" />
                      <p>Interested in opportunities that are <strong className="gold-text">Legacy-Making.</strong></p>
                      <p className="hero-muted">They build his personal brand long-term through more involvements.</p>
                      <div className="hero-divider" />
                      <p><strong>He gets excited for opportunities that</strong></p>
                      <p className="pill-row">
                        <span className="pill">Advocate for social justice</span>
                        <span className="pill-divider">|</span>
                        <span className="pill">Support his community</span>
                        <span className="pill-divider">|</span>
                        <span className="pill">Reflect his personal background</span>
                      </p>
                      <div className="hero-divider" />
                      <p><strong>He wants to play an active role in his brand partnerships.</strong></p>
                    </div>
                    <div className="hero-block light">
                      <div className="interests-header">His passions and interests include</div>
                      <div className="hero-divider" />
                      <div className="pills">
                        <span className="pill-tag">Finance & Business</span>
                        <span className="pill-tag">Education</span>
                        <span className="pill-tag">Fashion</span>
                        <span className="pill-tag">Media & Entertainment</span>
                        <span className="pill-tag">Non-Profits</span>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 2) Audience */}
              <section id="audience" className="review-section">
                <h2 className="section-title">Audience</h2>
                <div className="hero-divider" />
                <p className="empty-state-text">Audience insights coming soon.</p>
              </section>

              {/* 3) Past Activations */}
              <section id="past-activations" className="review-section">
                <h2 className="section-title">Past Activations</h2>
                <div className="hero-divider" />
                {player?.partnerships?.length > 0 ? (
                  <div className="activations-grid">
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
                        {p.playerFee != null && p.playerFee !== "" && (
                          <div className="activation-row">
                            <span className="activation-label">Player Fee</span>
                            <span className="activation-value">{p.playerFee}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="empty-state-text">No past activations yet.</p>
                )}
              </section>

              {/* 4) Brand Fit */}
              <section id="brand-fit" className="review-section">
                <h2 className="section-title gold">Brand Fit</h2>
                <div className="hero-divider" />
                <p className="section-body">Brand fit insights and alignment notes will appear here when available.</p>
              </section>

              {/* 5) Notes */}
              <section id="notes" className="review-section">
                <h2 className="section-title gold">Notes</h2>
                <div className="hero-divider" />
                <p className="section-body">Additional notes and context for this player review.</p>
              </section>
            </>
          )}
        </div>
      </main>

      <style jsx>{`
        .page {
          min-height: 100vh;
          background: var(--color-page-bg);
          color: var(--nbpa-text-on-light);
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-weight: 400;
          font-size: 14px;
        }

        .main-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 1000;
          background: var(--nbpa-header-bg);
          height: 90px;
          display: flex;
          align-items: center;
        }
        .header-inner {
          max-width: 1224px;
          width: 92%;
          margin: 0 auto;
        }
        .back {
          color: var(--nbpa-text-on-dark);
          text-decoration: none;
          font-size: 14px;
        }
        .back:hover { color: var(--nbpa-gold); }

        .main { padding: 7rem 0 4rem; }
        .container {
          max-width: 1224px;
          width: 92%;
          margin: 0 auto;
        }

        .state {
          text-align: center;
          padding: 3rem;
          color: var(--color-muted);
        }
        .page-title {
          margin: 0 0 1.5rem 0;
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-size: 1.75rem;
          font-weight: 800;
          color: var(--nbpa-text-on-light);
        }

        /* Sticky TOC */
        .review-toc {
          position: sticky;
          top: 90px;
          z-index: 10;
          display: flex;
          flex-wrap: wrap;
          gap: 0 1.5rem;
          padding: 1rem 0;
          margin-bottom: 2rem;
          background: var(--color-page-bg);
          border-bottom: 1px solid var(--color-border);
        }
        .review-toc-link {
          color: var(--nbpa-text-on-light);
          text-decoration: none;
          font-size: 14px;
          font-weight: 500;
        }
        .review-toc-link:hover { color: var(--nbpa-gold); }

        #player-profile, #audience, #past-activations, #brand-fit, #notes {
          scroll-margin-top: 6rem;
        }

        /* Player Hero */
        .player-hero {
          margin-bottom: 2.5rem;
          border: 1px solid var(--color-border);
          overflow: hidden;
        }
        .hero-layout {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 320px;
        }
        @media (max-width: 768px) {
          .hero-layout { grid-template-columns: 1fr; }
        }
        .hero-left {
          background: var(--nbpa-dark-bg);
          color: var(--nbpa-text-on-dark);
          padding: 2rem;
        }
        .hero-right {
          background: var(--color-page-bg-alt);
          color: var(--nbpa-text-on-light);
          padding: 2rem;
        }
        .hero-name {
          margin: 0 0 1rem 0;
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-size: clamp(1.5rem, 4vw, 2.25rem);
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          line-height: 1.15;
          color: var(--nbpa-text-on-dark);
        }
        .hero-name .name-first { display: block; font-size: 1.1em; }
        .hero-name .name-last { display: block; font-size: 0.9em; opacity: 0.95; }
        .hero-block {
          margin-top: 1.25rem;
        }
        .hero-block.light { margin-top: 1.25rem; }
        .hero-block-title {
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-size: 0.75rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--nbpa-text-on-dark);
        }
        .hero-block-title.gold { color: var(--nbpa-gold); }
        .hero-right .hero-block-title { color: var(--nbpa-text-on-light); }
        .hero-right .hero-block-title.gold { color: var(--nbpa-gold); }
        .hero-divider {
          height: 1px;
          background: rgba(255,255,255,0.2);
          margin: 0.5rem 0 0.75rem 0;
        }
        .hero-right .hero-divider { background: rgba(0,0,0,0.1); }
        .stats-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 0.35rem 0 0.75rem;
        }
        .stat-item { display: flex; flex-direction: column; gap: 0.1rem; }
        .stat-item.full-width { grid-column: 1 / -1; }
        .stat-label { font-size: 0.8rem; color: rgba(255,255,255,0.8); }
        .hero-right .stat-label { color: var(--color-muted); }
        .stat-value { font-weight: 700; font-size: 0.95rem; color: var(--nbpa-text-on-dark); }
        .hero-right .stat-value { color: var(--nbpa-text-on-light); }
        .hero-muted { font-size: 0.9rem; color: rgba(255,255,255,0.85); margin: 0.35rem 0 0 0; }
        .hero-right .hero-muted { color: var(--color-muted); }
        .hero-image-wrap {
          margin: 0 0 1.25rem 0;
          border-radius: 4px;
          overflow: hidden;
          max-width: 280px;
        }
        .hero-image {
          width: 100%;
          height: auto;
          display: block;
        }
        .social-list { margin-top: 0.25rem; }
        .social-row {
          display: grid;
          grid-template-columns: auto 1fr;
          align-items: center;
          gap: 0.5rem 0.75rem;
          margin-bottom: 0.35rem;
          font-size: 14px;
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
        .social-ig { background: linear-gradient(135deg, #f09433, #e6683c, #dc2743, #cc2366); color: var(--nbpa-text-on-dark); }
        .social-tw { background: #1da1f2; color: var(--nbpa-text-on-dark); }
        .social-fb { background: #1877f2; color: var(--nbpa-text-on-dark); }
        .social-link { color: var(--nbpa-gold); text-decoration: underline; }
        .social-muted { color: rgba(255,255,255,0.7); font-size: 0.9rem; }
        .hero-right .social-muted { color: var(--color-muted); }
        .social-followers, .social-engagement { font-weight: 600; }
        .gold-text { color: var(--nbpa-gold); }
        .pill-row { margin: 0.35rem 0; font-size: 14px; }
        .pill-divider { margin: 0 0.35rem; color: var(--color-muted-light); }
        .interests-header {
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-weight: 800;
          font-size: 0.95rem;
          color: var(--nbpa-text-on-light);
        }
        .pills {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
          margin: 0.5rem 0 0 0;
        }
        .pill-tag {
          border: 1px solid #ccc;
          padding: 0.35rem 0.65rem;
          border-radius: 999px;
          font-size: 0.75rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          color: var(--color-body);
        }

        /* Review sections */
        .review-section {
          margin-bottom: 2.5rem;
          padding: 0 0 0.5rem 0;
        }
        .section-title {
          font-family: var(--font-montserrat), "Montserrat", sans-serif;
          font-size: 1.1rem;
          font-weight: 800;
          color: var(--nbpa-text-on-light);
          margin: 0 0 0.5rem 0;
        }
        .section-title.gold { color: var(--nbpa-gold); }
        .section-body { margin: 0.5rem 0 0 0; font-size: 14px; color: var(--color-body); }
        .empty-state-text {
          margin: 0.5rem 0 0 0;
          font-size: 14px;
          color: var(--color-muted);
        }

        .activations-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem;
          margin-top: 1rem;
        }
        .activation-card {
          border: 1px solid var(--color-border);
          border-radius: 6px;
          padding: 1.25rem;
          background: var(--color-page-bg-alt);
        }
        .activation-row {
          display: grid;
          grid-template-columns: 110px 1fr;
          gap: 0.5rem 0.75rem;
          margin-bottom: 0.5rem;
          font-size: 14px;
        }
        .activation-row:last-child { margin-bottom: 0; }
        .activation-label { color: var(--color-muted); font-weight: 500; }
        .activation-value { color: var(--nbpa-text-on-light); font-weight: 500; }
      `}</style>
    </div>
  );
}
