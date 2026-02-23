# Instagram scraping – where to put usernames and how to keep data updated

## Where to put player Instagram usernames
X
Usernames are stored in your **database** on the **Player** model, in the **`instagram`** field (no `@` required; the app will add it on the frontend).

### Option 1: Prisma Studio (good for one-off edits)

1. Run: `npx prisma studio`
2. Open the **Player** table.
3. For each player, set **instagram** to their handle (e.g. `kingjames`, `stephencurry30`).
4. Save.

Only players that exist in your DB and have **nbaPersonId** matching the NBA API will show on the site. Your seed already creates LeBron (nbaPersonId `2544`) and Curry (nbaPersonId `201939`) with instagram set.

### Option 2: Seed file (good for a fixed list)

Edit **`prisma/seed.js`** and add or update players with an **instagram** field:

```js
await prisma.player.upsert({
  where: { nbaPersonId: "2544" },
  update: { instagram: "kingjames" },
  create: { name: "LeBron James", team: "LAL", position: "F", nbaPersonId: "2544", instagram: "kingjames" },
});
```

Then run `npm run seed`.

### Option 3: Sync all NBA players into the DB, then set usernames

To have a row for every current NBA player and then set Instagram only for some:

- Add a script that fetches all active players from the NBA API and **upserts** into **Player** (by **nbaPersonId**), leaving **instagram** null.
- Then use Prisma Studio or seed to set **instagram** only for the players you want to scrape.

The scraper only runs for players where **instagram** is not null.

---

## How the scraper works

The app uses the same idea as the article:

- Request Instagram profile JSON (e.g. `https://www.instagram.com/{username}/?__a=1`).
- Parse **followers** and **following** from the response.
- Save them (and optional **avgLikes**, **avgComments**, **engagementRate** if you add that scraping later) on **Player** and set **instagramUpdatedAt**.

If Instagram blocks or changes the endpoint, you can proxy requests through **ScraperAPI** (or similar) by setting **SCRAPER_API_URL** in `.env` (see below).

---

## Running the scraper continuously

### 1. One-off run (terminal)

```bash
npm run scrape-instagram
```

This:

- Loads all players where **instagram** is set.
- Scrapes each profile (with a short delay between requests to reduce blocking).
- Updates **followers**, **following**, and **instagramUpdatedAt** in the DB.

### 2. Cron job (recommended for “constantly updated”)

Call the cron API on a schedule (e.g. every hour) so the DB stays updated and the frontend always shows fresh data when you open a player.

**Endpoint:** `POST /api/cron/instagram`

**Auth (recommended):** Set in `.env`:

```env
CRON_SECRET=your-secret-string
```

Then send:

```http
POST /api/cron/instagram
Authorization: Bearer your-secret-string
```

**Examples:**

- **Vercel Cron:** In `vercel.json` add a cron that hits `https://your-domain.com/api/cron/instagram` with the `Authorization` header.
- **External cron (e.g. cron-job.org):** Schedule a request every hour to the same URL and header.
- **GitHub Actions:** Run a workflow on a schedule that `curl -X POST -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" https://your-domain.com/api/cron/instagram`.

The handler:

- Finds all players with **instagram** set.
- Scrapes each (with a delay).
- Writes **followers**, **following**, **instagramUpdatedAt** to the DB.
- Returns `{ ok, playersChecked, playersUpdated }`.

The **player detail page** reads from your API, which merges in this DB data, so the frontend shows up-to-date followers/following and “Last updated” without you doing anything else.

---

## Optional: ScraperAPI (if Instagram blocks you)

If you get blocked or the public profile endpoint stops working:

1. Sign up for [ScraperAPI](https://www.scraperapi.com/) (or similar).
2. In `.env` add something like (adjust to the provider’s docs):

```env
SCRAPER_API_URL=https://api.scraperapi.com?api_key=YOUR_KEY&url=
```

The scraper will use this URL to proxy the Instagram profile request when the direct request fails.

---

## Summary

| What | Where / How |
|------|------------------|
| **Where to put usernames** | **Player.instagram** in the DB (Prisma Studio, seed, or a sync script). |
| **One-off scrape** | `npm run scrape-instagram` |
| **Continuous updates** | Call `POST /api/cron/instagram` (with `CRON_SECRET`) on a schedule. |
| **Where it shows on the site** | On the **player detail page** when you click a player: Social media section with followers, following, and “Last updated”. |
