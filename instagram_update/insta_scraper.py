#!/usr/bin/env python3
"""
find_instagrams.py
Reads Player.csv (one column: player names), searches Google for each player's
Instagram, extracts username, writes Player_with_instagram.csv preserving row order.
Uses Selenium + Chrome (not headless). Skips ads; only organic instagram.com results.
"""
from __future__ import annotations

import csv
import random
import re
import time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import (
    TimeoutException,
    WebDriverException,
)
from webdriver_manager.chrome import ChromeDriverManager

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
INPUT_FILE = SCRIPT_DIR / "players copy.numbers"  # Apple Numbers or CSV
OUTPUT_CSV = SCRIPT_DIR / "Player_with_instagram.csv"
GOOGLE_URL = "https://duckduckgo.com/"
DEFAULT_WAIT_TIMEOUT = 15
MIN_DELAY = 1.5
MAX_DELAY = 3.0

# URL path segments that are NOT profile pages (ignore these)
INSTAGRAM_NON_PROFILE_PATHS = {"p", "reel", "tv", "explore", "stories", "accounts", "direct", "reels"}


def random_delay():
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def _load_player_names_from_csv(path: Path) -> list[str]:
    """Load player names from CSV. Preserves order. Skips header row if it looks like 'name'."""
    names = []
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        for row in reader:
            if not row:
                continue
            name = (row[0] or "").strip()
            if not name:
                continue
            if len(names) == 0 and name.lower() in ("name", "player", "player name"):
                continue
            names.append(name)
    return names


def _load_player_names_from_numbers(path: Path) -> list[str]:
    """Load player names from Apple Numbers (first sheet, first table, first column). Preserves order."""
    from numbers_parser import Document  # type: ignore[import-untyped]

    names = []
    doc = Document(path)
    table = doc.sheets[0].tables[0]
    for row in table.iter_rows(values_only=True):
        if not row:
            continue
        raw = row[0]
        name = (str(raw).strip() if raw is not None else "")
        if not name:
            continue
        if len(names) == 0 and name.lower() in ("name", "player", "player name"):
            continue
        names.append(name)
    return names


def load_player_names(path: Path) -> list[str]:
    """Load player names from CSV or Apple Numbers. Preserves order."""
    suffix = path.suffix.lower()
    if suffix == ".numbers":
        return _load_player_names_from_numbers(path)
    return _load_player_names_from_csv(path)


def save_results(path: Path, rows: list[tuple[str, str]]) -> None:
    """Write full output CSV with header. rows = [(name, instagram), ...]."""
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "instagram"])
        for name, instagram in rows:
            w.writerow([name, instagram or ""])


def is_captcha_or_blocked(driver) -> bool:
    """Check for Google/DuckDuckGo captcha or 'blocked' / 'unusual traffic' type page."""
    try:
        body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
        current_url = (driver.current_url or "").lower()
        if "captcha" in body_text or "unusual traffic" in body_text or "automated" in body_text:
            return True
        if "sorry" in body_text and "blocked" in body_text:
            return True
        if "duckduckgo" in current_url and "detected unusual traffic" in body_text:
            return True
    except Exception:
        pass
    return False


def get_first_organic_instagram_url(driver) -> str | None:
    """
    DuckDuckGo-safe version:
    Scan ALL anchor tags and return the first valid instagram.com profile link.
    Avoid relying on fragile DDG class names.
    """
    try:
        anchors = driver.find_elements(By.CSS_SELECTOR, "a[href]")
        seen: set[str] = set()

        for a in anchors:
            href = (a.get_attribute("href") or "").strip()
            if not href or href in seen:
                continue
            seen.add(href)

            # must contain instagram profile
            if "instagram.com/" not in href:
                continue

            match = re.search(r"instagram\.com/([^/?#]+)", href, re.I)
            if not match:
                continue

            segment = match.group(1).lower()

            # skip non-profile paths
            if segment in INSTAGRAM_NON_PROFILE_PATHS:
                continue

            return href

        return None
    except Exception:
        return None


def username_from_instagram_url(url: str) -> str | None:
    """Extract profile username from instagram.com URL. Returns None if path is non-profile (p/, reel/, etc.)."""
    if not url or "instagram.com" not in url:
        return None
    match = re.search(r"instagram\.com/([^/?]+)", url, re.I)
    if not match:
        return None
    segment = match.group(1).strip()
    if segment.lower() in INSTAGRAM_NON_PROFILE_PATHS:
        return None
    return segment


def find_instagram_for_player(driver: webdriver.Chrome, name: str) -> str | None:
    """
    For one player: Google search -> first instagram.com profile URL from results -> extract username from URL only.
    Does not open Instagram pages.
    """
    wait = WebDriverWait(driver, DEFAULT_WAIT_TIMEOUT)
    query = f"{name} instagram site:instagram.com"

    try:
        driver.get(GOOGLE_URL)
        random_delay()

        if is_captcha_or_blocked(driver):
            return None

        search_box = wait.until(EC.presence_of_element_located((By.NAME, "q")))
        search_box.clear()
        search_box.send_keys(query)
        search_box.send_keys(Keys.RETURN)
        random_delay()

        if is_captcha_or_blocked(driver):
            return None

        wait.until(
            EC.presence_of_element_located(
                (By.CSS_SELECTOR, "a[href*='instagram.com/']")
            )
        )
        first_instagram_url = get_first_organic_instagram_url(driver)
        if not first_instagram_url:
            return None

        return username_from_instagram_url(first_instagram_url)
    except TimeoutException:
        first_instagram_url = get_first_organic_instagram_url(driver)
        if first_instagram_url:
            return username_from_instagram_url(first_instagram_url)
        return None
    except Exception:
        return None


def main() -> None:
    if not INPUT_FILE.exists():
        print(f"Input file not found: {INPUT_FILE}")
        return

    names = load_player_names(INPUT_FILE)
    if not names:
        print("No player names found in CSV.")
        return

    total = len(names)
    print(f"Loaded {total} players from {INPUT_FILE}")
    print(f"Output: {OUTPUT_CSV}")
    print("Chrome will open (not headless). Do not close the browser.\n")

    # Load existing output so we can resume. Preserve exact input row order: no sorting, no dict reordering.
    results: list[tuple[str, str]] = []
    if OUTPUT_CSV.exists():
        with open(OUTPUT_CSV, newline="", encoding="utf-8", errors="replace") as f:
            r = csv.DictReader(f)
            for row in r:
                results.append((row.get("name", "").strip(), row.get("instagram", "").strip()))
        print(f"Resuming: found {len(results)} existing rows in output.\n")

    # Build rows in exact input order: one row per name, fill instagram from existing results by name match.
    name_to_instagram = {
        name: (ig or "").strip()
        for name, ig in results
    }
    rows: list[tuple[str, str]] = []
    for name in names:
        rows.append((name, name_to_instagram.get(name, "")))

    # Which index to start from (first row missing instagram)
    start_index = 0
    for i, (name, ig) in enumerate(rows):
        if not ig:
            start_index = i
            break
    else:
        print("All players already have Instagram usernames in output. Exiting.")
        return

    options = Options()
    # Not headless
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.implicitly_wait(2)

    try:
        for i in range(start_index, total):
            name = names[i]
            try:
                instagram = find_instagram_for_player(driver, name)
            except Exception as e:
                print(f"Error for '{name}': {e}")
                instagram = None

            instagram = (instagram or "").strip().lstrip("@")
            rows[i] = (name, instagram)
            save_results(OUTPUT_CSV, rows)

            disp = instagram if instagram else "(not found)"
            print(f"{i + 1}/{total} {name} -> {disp}")

            if is_captcha_or_blocked(driver):
                print("\nGoogle has shown a captcha or blocked the request. Stop and run again later.")
                break

            random_delay()
    finally:
        driver.quit()

    print(f"\nDone. Output saved to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
