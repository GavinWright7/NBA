require("dotenv").config();
const { PrismaClient } = require("../generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const RPS = Math.max(0.1, Math.min(1, parseFloat(process.env.IG_RPS) || 0.2));
const DELAY_MS = Math.ceil(1000 / RPS);
const SYNC_LIMIT = process.env.IG_SYNC_LIMIT ? parseInt(process.env.IG_SYNC_LIMIT, 10) : null;
const USER_AGENT =
  process.env.IG_USER_AGENT ||
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseCount(s) {
  if (s == null || typeof s !== "string") return null;
  const t = s.trim().replace(/,/g, "");
  if (t.length === 0) return null;
  const match = t.match(/^([\d.]+)\s*([KMB])?$/i);
  if (!match) return null;
  let n = parseFloat(match[1], 10);
  if (Number.isNaN(n)) return null;
  const suffix = (match[2] || "").toUpperCase();
  if (suffix === "K") n *= 1e3;
  else if (suffix === "M") n *= 1e6;
  else if (suffix === "B") n *= 1e9;
  return Math.round(n);
}

function extractFromOgDescription(html) {
  const ogMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);
  if (!ogMatch) return null;
  const desc = ogMatch[1];
  let followers = null;
  let following = null;
  let posts = null;
  const followersMatch = desc.match(/([\d.,]+\s*[KMB]?)\s*Followers?/i);
  if (followersMatch) followers = parseCount(followersMatch[1]);
  const followingMatch = desc.match(/([\d.,]+\s*[KMB]?)\s*Following/i);
  if (followingMatch) following = parseCount(followingMatch[1]);
  const postsMatch = desc.match(/([\d.,]+\s*[KMB]?)\s*Posts?/i);
  if (postsMatch) posts = parseCount(postsMatch[1]);
  return { followers, following, postsCount: posts };
}

function extractInstagramUrlFromDdgHtml(html, handle) {
  const lowerHandle = (handle || "").toLowerCase().replace(/^@/, "");
  const directRe = /href="(https?:\/\/(?:www\.)?instagram\.com\/([^/"?#]+)(?:\/)?)"/gi;
  const seen = new Set();
  let match;
  let first = null;
  while ((match = directRe.exec(html)) !== null) {
    const url = match[1].replace(/\\u0026/g, "&");
    const user = (match[2] || "").toLowerCase().trim();
    if (seen.has(user)) continue;
    seen.add(user);
    if (!/^[\w.]+$/.test(user)) continue;
    if (user === lowerHandle) return url;
    if (!first) first = url;
  }
  if (first) return first;
  const anyRe = /href="[^"]*instagram\.com\/([^/"?#]+)/gi;
  while ((match = anyRe.exec(html)) !== null) {
    const user = (match[1] || "").toLowerCase().trim();
    if (/^[\w.]+$/.test(user)) return `https://www.instagram.com/${user}/`;
  }
  return null;
}

async function fetchWithRetry(url, options, retries = MAX_RETRIES) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) await sleep(1000 * Math.pow(2, attempt - 1));
      const res = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
          ...options?.headers,
        },
      });
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (attempt < retries) continue;
        throw new Error(`HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt === retries) throw lastErr;
    }
  }
  throw lastErr;
}

async function findProfileUrlViaDdg(handle, playerName) {
  const q1 = `site:instagram.com ${handle.replace(/^@/, "")}`;
  const url1 = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q1)}`;
  try {
    const html = await fetchWithRetry(url1, { method: "GET" });
    const found = extractInstagramUrlFromDdgHtml(html, handle);
    if (found) return found;
  } catch (_) {}
  const q2 = `${playerName} instagram`;
  const url2 = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q2)}`;
  try {
    const html = await fetchWithRetry(url2, { method: "GET" });
    return extractInstagramUrlFromDdgHtml(html, handle);
  } catch (_) {}
  return null;
}

async function fetchProfileMetrics(handle, playerName) {
  const cleanHandle = (handle || "").trim().replace(/^@/, "").toLowerCase();
  if (!cleanHandle) return null;
  let profileUrl = `https://www.instagram.com/${cleanHandle}/`;
  const fromDdg = await findProfileUrlViaDdg(cleanHandle, playerName || cleanHandle);
  if (fromDdg) profileUrl = fromDdg;
  try {
    const html = await fetchWithRetry(profileUrl, { method: "GET" });
    const extracted = extractFromOgDescription(html);
    if (extracted && (extracted.followers != null || extracted.following != null || extracted.postsCount != null)) {
      return {
        handle: cleanHandle,
        followers: extracted.followers,
        following: extracted.following,
        postsCount: extracted.postsCount,
        recentPostsJson: null,
      };
    }
  } catch (err) {
    throw err;
  }
  return null;
}

async function syncOne(player) {
  const handle = (player.instagram || "").trim();
  if (!handle) return { ok: false, error: "No handle" };
  try {
    const data = await fetchProfileMetrics(handle, player.name);
    if (!data) {
      await upsertMetrics(prisma, player.id, handle, null, "No og:description or counts found");
      return { ok: false, error: "No data extracted" };
    }
    await upsertMetrics(prisma, player.id, data.handle, data, null);
    return { ok: true };
  } catch (err) {
    const msg = (err?.message || String(err)).slice(0, 500);
    await upsertMetrics(prisma, player.id, handle.replace(/^@/, "").toLowerCase(), null, msg);
    return { ok: false, error: msg };
  }
}

async function upsertMetrics(prisma, playerId, handle, data, lastError) {
  await prisma.instagramProfileMetrics.upsert({
    where: { playerId },
    create: {
      playerId,
      handle,
      followers: data?.followers ?? undefined,
      following: data?.following ?? undefined,
      postsCount: data?.postsCount ?? undefined,
      recentPostsJson: data?.recentPostsJson ?? undefined,
      lastFetchedAt: data ? new Date() : undefined,
      provider: "duckduckgo+instagram",
      lastError: lastError ?? undefined,
    },
    update: {
      handle,
      ...(data && {
        followers: data.followers ?? undefined,
        following: data.following ?? undefined,
        postsCount: data.postsCount ?? undefined,
        recentPostsJson: data.recentPostsJson ?? undefined,
        lastFetchedAt: new Date(),
        lastError: undefined,
      }),
      ...(lastError && { lastError }),
    },
  });
}

async function main() {
  console.log("[ig:sync] starting");
  const players = await prisma.player.findMany({
    where: { instagram: { not: null, not: "" } },
    select: { id: true, name: true, instagram: true },
  });
  let list = players;
  if (SYNC_LIMIT != null && SYNC_LIMIT > 0) list = list.slice(0, SYNC_LIMIT);
  let successes = 0;
  let failures = 0;
  let blocked429 = 0;
  for (let i = 0; i < list.length; i++) {
    await sleep(DELAY_MS);
    const p = list[i];
    try {
      const result = await syncOne(p);
      if (result.ok) successes++;
      else {
        failures++;
        if (result.error && result.error.includes("429")) blocked429++;
      }
    } catch (err) {
      failures++;
      if (err?.message?.includes("429")) blocked429++;
      console.error(`[${p.instagram}]`, err?.message || err);
    }
  }
  console.log("Total handles processed:", list.length);
  console.log("Successes:", successes);
  console.log("Failures:", failures);
  console.log("Blocked/429 count:", blocked429);
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
  });
