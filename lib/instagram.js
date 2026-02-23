/**
 * Scrape public Instagram profile for followers and following count.
 * Uses the same approach as the article: request profile JSON.
 * If Instagram blocks or changes the endpoint, set SCRAPER_API_URL in .env
 * to proxy through ScraperAPI (e.g. https://api.scraperapi.com?api_key=KEY&url=...).
 */

const INSTAGRAM_PROFILE_URL = "https://www.instagram.com";

function parseProfileJson(body) {
  try {
    const data = typeof body === "string" ? JSON.parse(body) : body;
    const user = data?.graphql?.user ?? data?.user ?? data;
    const followers = user?.edge_followed_by?.count ?? user?.followers_count ?? user?.follower_count;
    const following = user?.edge_follow?.count ?? user?.following_count ?? user?.following_count;
    if (followers == null && following == null) return null;
    return {
      followers: typeof followers === "number" ? followers : null,
      following: typeof following === "number" ? following : null,
    };
  } catch {
    return null;
  }
}

async function fetchProfileUrl(username) {
  const url = `${INSTAGRAM_PROFILE_URL}/${encodeURIComponent(username)}/?__a=1&__d=dis`;
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
    Referer: "https://www.instagram.com/",
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, body: null };
    const body = await res.text();
    return { ok: true, body };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, body: null };
  }
}

async function scrapeInstagramProfile(username) {
  if (!username || typeof username !== "string") return null;
  const trimmed = username.replace(/^@/, "").trim();
  if (!trimmed) return null;

  let result = await fetchProfileUrl(trimmed);
  if (!result.ok && process.env.SCRAPER_API_URL) {
    const proxyUrl = `${process.env.SCRAPER_API_URL}&url=${encodeURIComponent(
      `${INSTAGRAM_PROFILE_URL}/${trimmed}/?__a=1&__d=dis`
    )}`;
    const res = await fetch(proxyUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    }).catch(() => null);
    if (res?.ok) result = { ok: true, body: await res.text() };
  }

  if (!result.ok || !result.body) return null;
  return parseProfileJson(result.body);
}

module.exports = { scrapeInstagramProfile };
