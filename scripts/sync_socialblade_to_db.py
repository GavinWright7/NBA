#!/usr/bin/env python3
"""
sync_socialblade_to_db.py

1. Connects to Neon/Postgres and pulls every Player that has an Instagram handle.
2. Writes those handles to a temp CSV.
3. Runs scrape_socialblade.py on that CSV (unchanged — the scraper is not modified).
4. For each row the scraper returns with status=OK AND followers present, updates
   the Player record in the DB.  Only non-empty scraped fields are written so
   partial / failed scrapes leave existing data completely untouched.
5. Designed to be called once a day (via cron / launchd).

How to run manually:
    python3 scripts/sync_socialblade_to_db.py

Cron example (3 AM every day):
    0 3 * * * /bin/bash /path/to/NBA/scripts/run_socialblade_sync.sh
"""

import csv
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────

SCRIPTS_DIR  = Path(__file__).parent.resolve()
PROJECT_ROOT = SCRIPTS_DIR.parent
ENV_FILE     = PROJECT_ROOT / ".env"
SCRAPER      = Path("/Users/gavinwright/Desktop/SocialBlade Scraper/scrape_socialblade.py")
LOG_FILE     = PROJECT_ROOT / "data" / "socialblade_sync.log"

# ─────────────────────────────────────────────────────────────────────────────
# Env / connection
# ─────────────────────────────────────────────────────────────────────────────

def load_database_url() -> str:
    """Read DATABASE_URL from the project .env file."""
    if not ENV_FILE.exists():
        sys.exit(f"[ERROR] .env not found at {ENV_FILE}")
    for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("DATABASE_URL="):
            return line.split("=", 1)[1].strip()
    sys.exit("[ERROR] DATABASE_URL not found in .env")


def psycopg2_url(url: str) -> str:
    """Remove channel_binding=... which psycopg2 does not understand."""
    return re.sub(r"[&?]channel_binding=[^&]*", "", url)


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────

def get_players(conn) -> list[dict]:
    """Return every Player that has an Instagram handle."""
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("""
            SELECT id, name, instagram
            FROM   "Player"
            WHERE  instagram IS NOT NULL AND instagram <> ''
            ORDER  BY name
        """)
        return cur.fetchall()


def update_player(conn, player_id: str, fields: dict) -> None:
    """UPDATE only the columns that are present in *fields*."""
    if not fields:
        return
    set_clause = ", ".join(f'"{k}" = %({k})s' for k in fields)
    fields["_id"] = player_id
    sql = f'UPDATE "Player" SET {set_clause} WHERE id = %(_id)s'
    with conn.cursor() as cur:
        cur.execute(sql, fields)
    conn.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Value converters
# ─────────────────────────────────────────────────────────────────────────────

def to_int(val: str):
    if not val:
        return None
    try:
        return int(round(float(str(val).replace(",", "").replace("%", "").strip())))
    except (ValueError, TypeError):
        return None


def to_float(val: str):
    if not val:
        return None
    try:
        return float(str(val).replace(",", "").replace("%", "").strip())
    except (ValueError, TypeError):
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────────────────────────────────────

_log_lines: list[str] = []


def log(msg: str) -> None:
    ts   = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    _log_lines.append(line)


def flush_log() -> None:
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, "a", encoding="utf-8") as fh:
        for line in _log_lines:
            fh.write(line + "\n")


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    log("=" * 60)
    log("SocialBlade → DB sync starting")
    log("=" * 60)

    if not SCRAPER.exists():
        log(f"[ERROR] Scraper not found: {SCRAPER}")
        flush_log()
        sys.exit(1)

    # 1. Connect to Postgres (Neon)
    db_url = psycopg2_url(load_database_url())
    try:
        conn = psycopg2.connect(db_url)
        log("Connected to database")
    except Exception as exc:
        log(f"[ERROR] DB connection failed: {exc}")
        flush_log()
        sys.exit(1)

    # 2. Fetch players with IG handles
    players = get_players(conn)
    log(f"Players with Instagram handles: {len(players)}")

    # Build normalised handle → player map
    handle_map: dict[str, dict] = {}
    for p in players:
        handle = (p["instagram"] or "").strip().lstrip("@").lower()
        if handle:
            handle_map[handle] = p

    if not handle_map:
        log("[WARN] No Instagram handles found in DB — nothing to scrape.")
        conn.close()
        flush_log()
        return

    # 3. Write handles to a temp input CSV
    tmp_in  = tempfile.NamedTemporaryFile(mode="w", suffix=".csv",
                                          delete=False, encoding="utf-8")
    tmp_out = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
    tmp_in_path  = Path(tmp_in.name)
    tmp_out_path = Path(tmp_out.name)
    tmp_out.close()

    writer = csv.writer(tmp_in)
    writer.writerow(["username"])
    for handle in handle_map:
        writer.writerow([handle])
    tmp_in.close()
    log(f"Wrote {len(handle_map)} handles to temp file")

    # 4. Run the scraper (unchanged)
    log(f"Running scraper ...")
    returncode = None
    try:
        proc = subprocess.Popen(
            [
                sys.executable,
                str(SCRAPER),
                "--input",  str(tmp_in_path),
                "--output", str(tmp_out_path),
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        # Stream scraper output line-by-line so progress is visible in real time
        for line in proc.stdout:
            line = line.rstrip()
            if line:
                log(f"  [scraper] {line}")
        proc.wait(timeout=7200)
        returncode = proc.returncode
    except subprocess.TimeoutExpired:
        proc.kill()
        log("[ERROR] Scraper timed out after 2 hours.")
        tmp_in_path.unlink(missing_ok=True)
        tmp_out_path.unlink(missing_ok=True)
        conn.close()
        flush_log()
        sys.exit(1)
    except Exception as exc:
        log(f"[ERROR] Could not run scraper: {exc}")
        tmp_in_path.unlink(missing_ok=True)
        tmp_out_path.unlink(missing_ok=True)
        conn.close()
        flush_log()
        sys.exit(1)
    finally:
        tmp_in_path.unlink(missing_ok=True)

    if returncode != 0:
        log(f"[WARN] Scraper exited with code {returncode}")
    else:
        log("Scraper finished successfully")

    # 5. Read output CSV
    try:
        with open(tmp_out_path, newline="", encoding="utf-8") as fh:
            rows = list(csv.DictReader(fh))
    except Exception as exc:
        log(f"[ERROR] Cannot read scraper output: {exc}")
        tmp_out_path.unlink(missing_ok=True)
        conn.close()
        flush_log()
        sys.exit(1)
    finally:
        tmp_out_path.unlink(missing_ok=True)

    log(f"Scraper returned {len(rows)} rows — syncing to DB ...")

    # Reconnect — Neon drops idle connections after ~5 min and scraping takes longer
    try:
        conn.close()
    except Exception:
        pass
    try:
        conn = psycopg2.connect(db_url)
        log("Reconnected to database for DB updates")
    except Exception as exc:
        log(f"[ERROR] DB reconnect failed: {exc}")
        flush_log()
        sys.exit(1)

    now = datetime.now(timezone.utc)
    updated  = 0
    skipped  = 0
    no_match = 0

    for row in rows:
        username = (row.get("username") or "").strip().lower()
        status   = (row.get("status")   or "").strip()

        # Must match a player in our DB
        player = handle_map.get(username)
        if not player:
            no_match += 1
            continue

        # Only proceed for fully successful scrapes where followers is present.
        # Anything else leaves existing DB data untouched.
        if status != "OK" or not (row.get("followers") or "").strip():
            skipped += 1
            log(f"  SKIP  {username:<30s} status={status}")
            continue

        # Build update dict — only include fields that actually have values
        followers_v     = to_int(row.get("followers"))
        following_v     = to_int(row.get("following"))
        media_count_v   = to_int(row.get("media_count"))
        eng_rate_raw    = (row.get("engagement_rate") or "").strip()
        avg_likes_raw   = (row.get("avg_likes")       or "").strip()
        avg_comments_raw= (row.get("avg_comments")    or "").strip()

        eng_rate_v      = to_float(eng_rate_raw)
        avg_likes_v     = to_int(avg_likes_raw)
        avg_likes_f     = to_float(avg_likes_raw)
        avg_comments_v  = to_int(avg_comments_raw)
        avg_comments_f  = to_float(avg_comments_raw)

        fields: dict = {
            "igSbLastCheckedAt": now,
            "igSbStatus":        "ok",
        }
        any_stat = False

        if followers_v is not None:
            fields["followers"] = followers_v;   any_stat = True
        if following_v is not None:
            fields["following"] = following_v;   any_stat = True
        if media_count_v is not None:
            fields["posts"] = media_count_v;     any_stat = True
        if eng_rate_v is not None:
            fields["engagementRate"]   = eng_rate_v
            fields["igEngagementRate"] = eng_rate_v
            any_stat = True
        if avg_likes_v is not None:
            fields["avgLikes"]   = avg_likes_v
            fields["igAvgLikes"] = avg_likes_f
            any_stat = True
        if avg_comments_v is not None:
            fields["avgComments"]   = avg_comments_v
            fields["igAvgComments"] = avg_comments_f
            any_stat = True

        if any_stat:
            fields["instagramUpdatedAt"] = now

        try:
            update_player(conn, player["id"], fields)
            updated += 1
            log(
                f"  OK    {username:<30s} | followers={followers_v} "
                f"| eng={eng_rate_raw} | avgLikes={avg_likes_v}"
            )
        except Exception as exc:
            log(f"  [DB ERROR] {username}: {exc}")
            try:
                conn.rollback()
            except Exception:
                pass
            skipped += 1

    conn.close()
    log("=" * 60)
    log(
        f"Done — {updated} updated, {skipped} skipped/failed, "
        f"{no_match} handles not matched in DB"
    )
    log("=" * 60)
    flush_log()


if __name__ == "__main__":
    main()
