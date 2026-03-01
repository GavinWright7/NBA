import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname, isAbsolute } from "path";
import Papa from "papaparse";

const IG_RPS = Math.max(0.01, parseFloat(process.env.IG_RPS ?? "0.2"));
const DELAY_MS = Math.round(1000 / IG_RPS);
const IG_FETCH_TIMEOUT_MS = parseInt(process.env.IG_FETCH_TIMEOUT_MS ?? "15000", 10);
const IG_RETRIES = Math.max(1, parseInt(process.env.IG_RETRIES ?? "3", 10));
const IG_USER_AGENT =
  process.env.IG_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DDG_HTML = "https://html.duckduckgo.com/html/?q=";

const STATUS = {
  OK: "ok",
  NOT_FOUND: "not_found",
  BLOCKED: "blocked",
  PARSE_FAILED: "parse_failed",
  INVALID_NAME: "invalid_name",
  FETCH_FAILED: "fetch_failed",
};

const NON_PROFILE_SEGMENTS = new Set([
  "p",
  "reel",
  "tv",
  "explore",
  "stories",
  "accounts",
  "about",
  "developer",
  "directory",
  "direct",
  "reels",
  "legal",
  "press",
  "api",
  "help",
  "privacy",
  "terms",
]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function clampError(msg) {
  if (!msg) return "";
  return String(msg).slice(0, 200);
}

function resolvePathFromCwd(p) {
  if (!p) return null;
  return isAbsolute(p) ? p : join(process.cwd(), p);
}

function parseCount(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/,/g, "");
  const m = s.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  const suf = (m[2] || "").toUpperCase();
  if (suf === "K") n *= 1e3;
  else if (suf === "M") n *= 1e6;
  else if (suf === "B") n *= 1e9;
  return Math.round(n);
}

function parseOgDescription(html) {
  const m = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  if (!m) return null;
  const content = m[1];
  const followersMatch = content.match(/([\d.,]+\s*[KMB]?)\s*Followers?/i);
  const followingMatch = content.match(/([\d.,]+\s*[KMB]?)\s*Following/i);
  const postsMatch = content.match(/([\d.,]+\s*[KMB]?)\s*Posts?/i);
  return {
    followers: followersMatch ? parseCount(followersMatch[1]) : null,
    following: followingMatch ? parseCount(followingMatch[1]) : null,
    postsCount: postsMatch ? parseCount(postsMatch[1]) : null,
  };
}

function isLikelyHandle(segment) {
  return /^[a-zA-Z0-9_.]+$/.test(segment) && segment.length >= 2 && segment.length <= 30;
}

function normalizeInstagramProfileUrl(u) {
  try {
    const url = new URL(u);
    if (!/instagram\.com$/i.test(url.hostname) && !/\.instagram\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;
    const seg = parts[0].toLowerCase();
    if (NON_PROFILE_SEGMENTS.has(seg)) return null;
    if (!isLikelyHandle(parts[0])) return null;
    return `https://www.instagram.com/${parts[0]}/`;
  } catch {
    return null;
  }
}

function extractUrlsFromDdgHtml(html) {
  const urls = [];
  const seen = new Set();

  const hrefRe = /href="([^"]+)"/gi;
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    let href = m[1];
    href = href.replace(/&amp;/g, "&");

    if (href.startsWith("/l/?")) {
      try {
        const full = new URL("https://html.duckduckgo.com" + href);
        const uddg = full.searchParams.get("uddg");
        if (uddg) {
          const decoded = decodeURIComponent(uddg);
          if (!seen.has(decoded)) {
            seen.add(decoded);
            urls.push(decoded);
          }
        }
      } catch {}
      continue;
    }

    if (/^https?:\/\//i.test(href)) {
      if (!seen.has(href)) {
        seen.add(href);
        urls.push(href);
      }
    }
  }

  return urls;
}

function bestInstagramProfileFromDdg(html) {
  const urls = extractUrlsFromDdgHtml(html);

  const profileCandidates = [];
  for (const u of urls) {
    const normalized = normalizeInstagramProfileUrl(u);
    if (normalized) profileCandidates.push(normalized);
  }

  if (profileCandidates.length === 0) return null;

  const uniq = [];
  const set = new Set();
  for (const u of profileCandidates) {
    if (!set.has(u)) {
      set.add(u);
      uniq.push(u);
    }
  }

  return uniq[0];
}

async function fetchTextWithRetry(url, { timeoutMs = IG_FETCH_TIMEOUT_MS, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= IG_RETRIES; attempt++) {
    const controller = new AbortController();
    const to = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": IG_USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          ...headers,
        },
      });
      clearTimeout(to);

      if (res.status === 429) {
        if (attempt < IG_RETRIES) {
          await sleep(Math.min(1000 * 2 ** attempt, 15000));
          continue;
        }
        const e = new Error("HTTP 429");
        e.status = 429;
        throw e;
      }

      if (res.status >= 500 && res.status < 600) {
        if (attempt < IG_RETRIES) {
          await sleep(Math.min(1000 * 2 ** attempt, 15000));
          continue;
        }
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        throw e;
      }

      const text = await res.text();
      return { status: res.status, text };
    } catch (err) {
      clearTimeout(to);
      lastErr = err;
      if (attempt < IG_RETRIES) {
        await sleep(Math.min(1000 * 2 ** attempt, 15000));
        continue;
      }
    }
  }
  throw lastErr;
}

async function findProfileUrl(name) {
  const queries = [
    `site:instagram.com "${name}"`,
    `"${name}" instagram`,
  ];

  for (const q of queries) {
    const url = DDG_HTML + encodeURIComponent(q);
    try {
      const { text } = await fetchTextWithRetry(url);
      const profileUrl = bestInstagramProfileFromDdg(text);
      if (profileUrl) return { profileUrl };
    } catch (err) {
      if ((err && err.status) === 429 || String(err?.message || err).includes("429")) return { blocked: true };
    }
  }

  return { profileUrl: null };
}

function detectNameColumn(parsed) {
  const fields = parsed.meta?.fields || [];
  const want = ["name", "player_name", "real_name"];
  for (const w of want) {
    const f = fields.find((x) => String(x || "").toLowerCase() === w);
    if (f) return f;
  }
  return fields[0] || "name";
}

function handleFromProfileUrl(url) {
  const m = url.match(/instagram\.com\/([^/]+)/i);
  return m ? m[1] : "";
}

async function scrapeOne(name) {
  const row = {
    name,
    profileUrl: "",
    instagramHandle: "",
    followers: "",
    following: "",
    postsCount: "",
    status: "",
    error: "",
  };

  const trimmed = String(name || "").trim();
  if (!trimmed) {
    row.status = STATUS.INVALID_NAME;
    row.error = clampError("Empty name");
    return row;
  }

  const lookup = await findProfileUrl(trimmed);
  if (lookup.blocked) {
    row.status = STATUS.BLOCKED;
    row.error = clampError("DuckDuckGo rate limited (429)");
    return row;
  }
  if (!lookup.profileUrl) {
    row.status = STATUS.NOT_FOUND;
    row.error = clampError("No Instagram profile found via DuckDuckGo");
    return row;
  }

  row.profileUrl = lookup.profileUrl;
  row.instagramHandle = handleFromProfileUrl(lookup.profileUrl);

  try {
    const { text } = await fetchTextWithRetry(lookup.profileUrl);
    const counts = parseOgDescription(text);
    if (!counts || (counts.followers == null && counts.following == null && counts.postsCount == null)) {
      row.status = STATUS.PARSE_FAILED;
      row.error = clampError("Could not parse og:description");
      return row;
    }
    row.followers = counts.followers != null ? String(counts.followers) : "";
    row.following = counts.following != null ? String(counts.following) : "";
    row.postsCount = counts.postsCount != null ? String(counts.postsCount) : "";
    row.status = STATUS.OK;
    return row;
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("429")) {
      row.status = STATUS.BLOCKED;
      row.error = clampError("Instagram rate limited (429)");
      return row;
    }
    row.status = STATUS.FETCH_FAILED;
    row.error = clampError(msg);
    return row;
  }
}

async function main() {
  const defaultInput = join(process.cwd(), "data", "ig_handles.csv");
  const defaultOutput = join(process.cwd(), "data", "ig_follow_counts.csv");

  const inputPath =
    resolvePathFromCwd(process.argv[2]) ??
    resolvePathFromCwd(process.env.INPUT_CSV) ??
    defaultInput;
  const outputPath = resolvePathFromCwd(process.argv[3]) ?? defaultOutput;

  if (!existsSync(inputPath)) {
    console.error("[ig:scrape] Input file not found:", inputPath);
    process.exit(1);
  }

  const csvRaw = readFileSync(inputPath, "utf-8");
  const parsed = Papa.parse(csvRaw, { header: true, skipEmptyLines: true });
  const nameCol = detectNameColumn(parsed);
  const names = (parsed.data || [])
    .map((r) => r[nameCol])
    .filter((n) => n != null && String(n).trim() !== "");

  const total = names.length;
  if (total === 0) {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, "name,profileUrl,instagramHandle,followers,following,postsCount,status,error\n", "utf-8");
    console.log("[ig:scrape] No names found.");
    return;
  }

  const results = [];
  const summary = { ok: 0, not_found: 0, blocked: 0, parse_failed: 0, invalid_name: 0, fetch_failed: 0 };

  for (let i = 0; i < total; i++) {
    const name = names[i];
    const row = await scrapeOne(name);
    results.push(row);
    summary[row.status] = (summary[row.status] || 0) + 1;

    const extra = row.status === STATUS.OK && row.followers ? ` (${row.followers} followers)` : "";
    console.log(`[ig:scrape] (${i + 1}/${total}) ${name} => ${row.status}${extra}`);

    if (i < total - 1) await sleep(DELAY_MS);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  const outCsv = Papa.unparse({
    fields: ["name", "profileUrl", "instagramHandle", "followers", "following", "postsCount", "status", "error"],
    data: results,
  });
  writeFileSync(outputPath, outCsv, "utf-8");

  console.log("\n[ig:scrape] Summary:");
  Object.entries(summary).forEach(([k, v]) => {
    if (v > 0) console.log(`  ${k}: ${v}`);
  });
  console.log("[ig:scrape] Wrote", outputPath);
}

main().catch((e) => {
  console.error("[ig:scrape] fatal:", e?.message || e);
  process.exit(1);
});
