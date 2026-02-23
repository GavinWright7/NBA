/**
 * API route: fetches current NBA players from stats.nba.com, filters active only,
 * returns { season, count, players: [{ id, name, headshot, team }] } sorted by name.
 */

function getCurrentSeason() {
  const now = new Date();
  const month = now.getMonth();
  const year = now.getFullYear();
  const startYear = month >= 9 ? year : year - 1;
  const endYearShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}-${endYearShort}`;
}

const HEADSHOT_BASE =
  "https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190";

export default async function handler(req, res) {
  const season = getCurrentSeason();
  const url = new URL("https://stats.nba.com/stats/commonallplayers");
  url.searchParams.set("IsOnlyCurrentSeason", "1");
  url.searchParams.set("LeagueID", "00");
  url.searchParams.set("Season", season);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.nba.com/",
        Origin: "https://www.nba.com/",
        Accept: "application/json, text/plain, */*",
      },
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({
        error: "NBA API request failed",
        status: response.status,
        details: text.slice(0, 200),
      });
    }

    const data = await response.json();
    const resultSets = data.resultSets || [];
    const playerSet = resultSets[0];
    if (!playerSet || !Array.isArray(playerSet.headers) || !Array.isArray(playerSet.rowSet)) {
      return res.status(502).json({
        error: "Unexpected NBA API response shape",
        season,
      });
    }

    const headers = playerSet.headers;
    const idxId = headers.indexOf("PERSON_ID");
    const idxName = headers.indexOf("DISPLAY_FIRST_LAST");
    const idxRoster = headers.indexOf("ROSTERSTATUS");
    const idxTeam = headers.indexOf("TEAM_ABBREVIATION");

    if (idxId === -1 || idxName === -1 || idxRoster === -1) {
      return res.status(502).json({
        error: "Missing expected columns in NBA API response",
        season,
        headers,
      });
    }

    const players = playerSet.rowSet
      .filter((row) => Number(row[idxRoster]) === 1)
      .map((row) => {
        const id = String(row[idxId]);
        const name = String(row[idxName] || "").trim() || "Unknown";
        const team = idxTeam >= 0 && row[idxTeam] != null ? String(row[idxTeam]).trim() : "";
        return {
          id,
          name,
          headshot: `${HEADSHOT_BASE}/${id}.png`,
          team: team || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

    res.setHeader(
      "Cache-Control",
      "s-maxage=3600, stale-while-revalidate=86400"
    );
    return res.status(200).json({
      season,
      count: players.length,
      players,
    });
  } catch (err) {
    console.error("[api/players]", err);
    return res.status(500).json({
      error: "Server error while fetching players",
      message: err.message,
    });
  }
}
