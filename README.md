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
- **News** — tabbed headlines, refreshed every 20 minutes. Each region gets
  a **🎨 Underground arts & culture** section with indie/DIY coverage:
  - *CARICOM*: Jamaica Observer, Barbados Today, St Lucia Times —
    arts: LargeUp, Repeating Islands, Caribbean Beat
  - *Africa*: BBC Africa — arts: The NATIVE, Music In Africa
  - *Eastern Europe*: BBC Europe, Kyiv Independent —
    arts: Bird In Flight, Lossi 36
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
