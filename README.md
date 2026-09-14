# Daily Briefing ☀️🌙

A briefing dashboard built with [Bun](https://bun.sh): weather,
regional news, and your outstanding ClickUp tasks — all on one page.
The heading, greeting, and accent theme shift with the time of day
(morning → afternoon → evening → night).

## Widgets

- **Weather** — current conditions + 5-day forecast via Open-Meteo (no key
  needed). Uses your approximate location from your IP by default (looked up
  once per page load via ipapi.co); search any city to override, or hit 📍
  to go back to IP location. Your city choice is remembered.
- **Tonight's sky** — a star map computed for 10:00 PM local time at your
  weather location: the brightest stars overhead, stick figures and names
  for the major constellations, and the three brightest stars to look for.
  Positions come from a built-in 95-star catalog and are degree-level
  accurate — fine for casual stargazing, not for navigation.
- **News** — tabbed headlines, refreshed every 20 minutes. Each region gets
  a **🎨 Underground arts & culture** section with indie/DIY coverage:
  - *CARICOM*: Jamaica Observer, Barbados Today, St Lucia Times —
    arts: LargeUp, Repeating Islands, Caribbean Beat
  - *Africa*: BBC Africa — arts: The NATIVE, Music In Africa
  - *Eastern Europe*: BBC Europe, Kyiv Independent —
    arts: Bird In Flight, Lossi 36
  - *🎨 Art & DIY* (global): Neural, Hyperallergic, We Make Money Not Art,
    Furtherfield — the closest working feeds to Rhizome / e-flux territory
  Art items are geo-filtered: only stories mentioning the areas of interest
  (matched against title + summary) are pulled — each regional tab shows its
  own region's art, and the Art & DIY tab shows items matching any of them.
  Headlines carry a ☆ bookmark button; saved stories collect in a foldable
  🔖 Bookmarks section (kept in your browser). The arts block also links out
  to [Rhizome](https://rhizome.org) and [e-flux](https://www.e-flux.com) for
  deeper DIY / net-art reading.
- **Tasks** — outstanding tasks from your ClickUp list (completed ones are
  hidden), with priority dots and due-date pills.
- **Headline mood** — linguistic scoring of the day's Hacker News front page
  (pessimism ↔ optimism) and The Guardian world headlines (fear ↔ hope).
  Lexicon-based (with basic negation handling), shown per source with a
  diverging meter plus the most negative / most positive headlines.

## Run it

```sh
bun install   # no dependencies, but keeps bun happy
bun run dev   # → http://localhost:3000
```

## ClickUp setup

The task widget needs a token and a list id. Copy the example and fill it in:

```sh
cp .env.example .env
```

```ini
CLICKUP_TOKEN=pk_your_personal_token
CLICKUP_LIST_ID=901418249044
```

Bun loads `.env` automatically. Get a personal token from ClickUp under
avatar → **Settings** → **Apps** → **API Token**. The list id is the number
in the URL when you open the list in ClickUp.

Without a token the widget shows a setup hint instead of failing the page.

## API

- `GET /api/weather?city=Kingston` (or `?lat=..&lon=..&name=..`)
- `GET /api/news?region=caricom|africa|easteurope` (returns `items` + `arts`)
- `GET /api/tasks`
- `GET /api/mood`
- `GET /api/health`

Responses are cached server-side (weather 15 min, news 20 min, tasks 10 min)
and the page auto-refreshes every 15 minutes.

## Deploy

Anywhere Bun runs: `bun run src/server.ts` (set `PORT` as needed).
