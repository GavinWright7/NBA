#!/usr/bin/env python3
"""
Read NBA_Instagram_Follow_Counts.csv, find rows with blank/missing following or followers,
and retry filling them using DuckDuckGo search + Instagram profile scraping (same method as instagram_counts.py).
"""

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
from selenium.common.exceptions import TimeoutException
from webdriver_manager.chrome import ChromeDriverManager

SCRIPT_DIR = Path(__file__).resolve().parent
OUTPUT_CSV = SCRIPT_DIR / "NBA_Instagram_Follow_Counts.csv"

DDG_URL = "https://duckduckgo.com/"
DEFAULT_WAIT_TIMEOUT = 15
MIN_DELAY = 1.5
MAX_DELAY = 3.0

INSTAGRAM_NON_PROFILE_PATHS = {"p", "reel", "tv", "explore", "stories", "accounts", "direct", "reels"}


def random_delay() -> None:
    time.sleep(random.uniform(MIN_DELAY, MAX_DELAY))


def is_missing(v: str) -> bool:
    t = (v or "").strip().lower()
    return t in ("", "na", "n/a", "none", "null")


def parse_count(s: str | None) -> int | None:
    if not s:
        return None
    t = s.strip().replace(",", "").upper()
    m = re.match(r"^(\d+(\.\d+)?)([KMB])?$", t)
    if not m:
        if t.isdigit():
            return int(t)
        return None
    num = float(m.group(1))
    suf = m.group(3)
    mult = 1
    if suf == "K":
        mult = 1_000
    elif suf == "M":
        mult = 1_000_000
    elif suf == "B":
        mult = 1_000_000_000
    return int(num * mult)


def save_results(path: Path, rows: list[tuple[str, str, str]]) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["name", "following", "followers"])
        for name, following, followers in rows:
            w.writerow([name, following, followers])


def is_captcha_or_blocked(driver: webdriver.Chrome) -> bool:
    try:
        body_text = (driver.find_element(By.TAG_NAME, "body").text or "").lower()
        if "captcha" in body_text or "unusual traffic" in body_text or "automated" in body_text:
            return True
        if "sorry" in body_text and "blocked" in body_text:
            return True
    except Exception:
        pass
    return False


def clean_instagram_profile_url(url: str) -> str | None:
    if not url or "instagram.com/" not in url:
        return None
    m = re.search(r"instagram\.com/([^/?#]+)", url, re.I)
    if not m:
        return None
    seg = (m.group(1) or "").strip()
    if not seg or seg.lower() in INSTAGRAM_NON_PROFILE_PATHS:
        return None
    return f"https://www.instagram.com/{seg}/"


def get_first_organic_instagram_profile_result_ddg(driver: webdriver.Chrome) -> tuple[str | None, str | None]:
    """
    DuckDuckGo results page: get first Instagram profile link and snippet text.
    """
    selectors = [
        'a[data-testid="result-title-a"]',
        "a.result__a",
        "a[href*='instagram.com/']",
    ]
    try:
        seen: set[str] = set()
        for sel in selectors:
            links = driver.find_elements(By.CSS_SELECTOR, sel)
            for a in links:
                href = (a.get_attribute("href") or "").strip()
                if not href or "instagram.com/" not in href or href in seen:
                    continue
                seen.add(href)

                prof = clean_instagram_profile_url(href)
                if not prof:
                    continue

                snippet = ""
                try:
                    container = a.find_element(By.XPATH, "./ancestor::*[self::article or self::div][1]")
                    snippet = (container.text or "").strip()
                except Exception:
                    try:
                        snippet = (a.find_element(By.XPATH, "./ancestor::div[1]").text or "").strip()
                    except Exception:
                        snippet = ""

                return prof, snippet

        return None, None
    except Exception:
        return None, None


def extract_prev_token_count(text: str, keyword: str) -> int | None:
    if not text:
        return None
    t = " ".join(text.split())
    m = re.search(rf"(\S+)\s+{re.escape(keyword)}\b", t, re.I)
    if not m:
        return None
    token = m.group(1).strip().replace("·", "").replace("•", "").replace("|", "").replace(",", "")
    return parse_count(token)


def parse_followers_following_from_text(text: str) -> tuple[int | None, int | None]:
    if not text:
        return None, None
    t = " ".join(text.split())
    followers = extract_prev_token_count(t, "followers")
    following = extract_prev_token_count(t, "following")
    return following, followers


def get_instagram_follow_counts_from_profile(
    driver: webdriver.Chrome, profile_url: str
) -> tuple[int | None, int | None]:
    wait = WebDriverWait(driver, DEFAULT_WAIT_TIMEOUT)
    try:
        driver.get(profile_url)
        random_delay()
        try:
            wait.until(lambda d: "instagram.com" in (d.current_url or "").lower())
        except Exception:
            pass

        src = driver.page_source or ""
        m = re.search(r'property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', src, re.I)
        if not m:
            try:
                time.sleep(2.0)
                src = driver.page_source or ""
                m = re.search(r'property=["\']og:description["\'][^>]*content=["\']([^"\']+)["\']', src, re.I)
            except Exception:
                m = None

        if not m:
            return None, None

        desc = m.group(1)
        following, followers = parse_followers_following_from_text(desc)
        return following, followers
    except Exception:
        return None, None


def find_counts_for_player(driver: webdriver.Chrome, name: str) -> tuple[int | None, int | None]:
    """DuckDuckGo search for '{name} instagram site:instagram.com', then parse snippet or visit profile."""
    wait = WebDriverWait(driver, DEFAULT_WAIT_TIMEOUT)
    query = f"{name} instagram site:instagram.com"
    try:
        driver.get(DDG_URL)
        random_delay()
        if is_captcha_or_blocked(driver):
            return None, None

        search_box = wait.until(EC.presence_of_element_located((By.NAME, "q")))
        search_box.clear()
        search_box.send_keys(query)
        search_box.send_keys(Keys.RETURN)

        random_delay()
        if is_captcha_or_blocked(driver):
            return None, None

        profile_url, snippet_text = get_first_organic_instagram_profile_result_ddg(driver)
        if not profile_url:
            return None, None

        following, followers = parse_followers_following_from_text(snippet_text or "")
        if following is not None and followers is not None:
            return following, followers

        following, followers = get_instagram_follow_counts_from_profile(driver, profile_url)
        return following, followers

    except TimeoutException:
        profile_url, snippet_text = get_first_organic_instagram_profile_result_ddg(driver)
        if not profile_url:
            return None, None
        following, followers = parse_followers_following_from_text(snippet_text or "")
        if following is not None and followers is not None:
            return following, followers
        following, followers = get_instagram_follow_counts_from_profile(driver, profile_url)
        return following, followers

    except Exception:
        return None, None


def load_existing_rows(path: Path) -> list[tuple[str, str, str]]:
    """Load CSV into list of (name, following, followers)."""
    rows: list[tuple[str, str, str]] = []
    if not path.exists():
        return rows
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if not row:
                continue
            name = (row[0] or "").strip()
            following = (row[1] or "").strip() if len(row) > 1 else ""
            followers = (row[2] or "").strip() if len(row) > 2 else ""
            if name:
                rows.append((name, following, followers))
    return rows


def main() -> None:
    if not OUTPUT_CSV.exists():
        print(f"Output CSV not found: {OUTPUT_CSV}")
        print("Run instagram_counts.py first to create it.")
        return

    rows = load_existing_rows(OUTPUT_CSV)
    if not rows:
        print("No rows in CSV.")
        return

    # Indices where following or followers is missing
    missing_indices = [
        i for i, (name, following, followers) in enumerate(rows)
        if is_missing(following) or is_missing(followers)
    ]

    if not missing_indices:
        print("No missing following/followers in CSV. Nothing to do.")
        return

    print(f"Found {len(missing_indices)} rows with missing following/followers (of {len(rows)} total).")
    print(f"Output: {OUTPUT_CSV}")
    print("Chrome will open (not headless). Do not close the browser.\n")

    options = Options()
    options.add_argument("--start-maximized")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])

    service = Service(ChromeDriverManager().install())
    driver = webdriver.Chrome(service=service, options=options)
    driver.implicitly_wait(2)

    try:
        for idx, i in enumerate(missing_indices):
            name, following_old, followers_old = rows[i]
            following_new, followers_new = find_counts_for_player(driver, name)

            # Merge: keep existing value if new is None, else use new
            following_out = str(following_new) if following_new is not None else following_old
            followers_out = str(followers_new) if followers_new is not None else followers_old

            rows[i] = (name, following_out, followers_out)
            save_results(OUTPUT_CSV, rows)

            disp = f"following={following_out or 'NA'} followers={followers_out or 'NA'}"
            print(f"{idx + 1}/{len(missing_indices)} {name} -> {disp}")

            random_delay()
    finally:
        driver.quit()

    print(f"\nDone. Output saved to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
