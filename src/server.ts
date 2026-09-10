// Daily briefing dashboard server (Bun).
// Serves the dashboard UI and proxies weather / news / ClickUp tasks.

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = new URL("../public/", import.meta.url).pathname;
const UA = { "User-Agent": "daily-briefing/1.0 (+local)" };

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function fetchWithTimeout(url: string, ms = 15000, init: RequestInit = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) }, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const CACHE = new Map<string, { at: number; data: unknown }>();
function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.data as T);
  return loader().then((data) => {
    CACHE.set(key, { at: Date.now(), data });
    return data;
  });
}

// ---------------------------------------------------------------------------
// weather (Open-Meteo, no key required)
// ---------------------------------------------------------------------------

const WEATHER: Record<number, [string, string]> = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"], 45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "⛈️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "❄️"], 75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"], 80: ["Light showers", "🌦️"],
  81: ["Showers", "🌧️"], 82: ["Violent showers", "⛈️"],
  85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Storm w/ hail", "⛈️"], 99: ["Storm w/ hail", "⛈️"],
};

function describe(code: number): [string, string] {
  return WEATHER[code] || ["—", "🌡️"];
}

async function handleWeather(url: URL): Promise<Response> {
  const city = url.searchParams.get("city")?.trim();
  let lat = url.searchParams.get("lat");
  let lon = url.searchParams.get("lon");
  let name = "";
  let country = "";

  if (city) {
    const g: any = await cached(`geo:${city.toLowerCase()}`, 24 * 3600 * 1000, async () => {
      const r = await fetchWithTimeout(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
      );
      if (!r.ok) throw new Error("geocoding failed");
      return r.json();
    });
    const hit = g?.results?.[0];
    if (!hit) return json({ error: `Couldn't find "${city}"` }, 404);
    lat = String(hit.latitude);
    lon = String(hit.longitude);
    name = hit.name;
    country = hit.country || "";
  }
  if (!lat || !lon) return json({ error: "Provide ?city= or ?lat= &lon=" }, 400);

  const w: any = await cached(`wx:${lat},${lon}`, 15 * 60 * 1000, async () => {
    const r = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=6`
    );
    if (!r.ok) throw new Error("weather fetch failed");
    return r.json();
  });

  const c = w.current;
  const [desc, icon] = describe(c.weather_code);
  const daily = w.daily.time.slice(0, 5).map((d: string, i: number) => {
    const [dd, ii] = describe(w.daily.weather_code[i]);
    return {
      date: d,
      high_c: Math.round(w.daily.temperature_2m_max[i]),
      low_c: Math.round(w.daily.temperature_2m_min[i]),
      description: dd,
      icon: ii,
    };
  });

  return json({
    place: name ? `${name}${country ? ", " + country : ""}` : `${lat}, ${lon}`,
    timezone: w.timezone,
    current: {
      temp_c: Math.round(c.temperature_2m),
      feels_c: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind_kph: Math.round(c.wind_speed_10m),
      description: desc,
      icon,
    },
    daily,
  });
}

// ---------------------------------------------------------------------------
// news (RSS feeds, merged per region)
// ---------------------------------------------------------------------------

const FEEDS: Record<string, { source: string; url: string }[]> = {
  caricom: [
    { source: "Jamaica Observer", url: "https://www.jamaicaobserver.com/feed/" },
    { source: "Barbados Today", url: "https://barbadostoday.bb/feed/" },
    { source: "St Lucia Times", url: "https://stluciatimes.com/feed/" },
  ],
  africa: [
    { source: "BBC Africa", url: "https://feeds.bbci.co.uk/news/world/africa/rss.xml" },
  ],
  easteurope: [
    { source: "BBC Europe", url: "https://feeds.bbci.co.uk/news/world/europe/rss.xml" },
    { source: "Kyiv Independent", url: "https://kyivindependent.com/news-archive/rss/" },
  ],
};

const REGION_LABELS: Record<string, string> = {
  caricom: "CARICOM",
  africa: "Africa",
  easteurope: "Eastern Europe",
};

function stripCdata(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function pick(m: RegExpMatchArray | null): string {
  return m ? stripCdata(m[1]) : "";
}

interface NewsItem {
  title: string;
  link: string;
  source: string;
  pubDate: string;
}

function parseRss(xml: string, source: string): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = [
    ...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi),
  ];
  for (const b of blocks) {
    const body = b[1];
    const title = pick(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i));
    let link = pick(body.match(/<link>([\s\S]*?)<\/link>/i));
    if (!link) link = pick(body.match(/<link[^>]*href="([^"]+)"/i));
    const pub =
      pick(body.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)) ||
      pick(body.match(/<(published|updated)>([\s\S]*?)<\/(published|updated)>/i));
    if (title && link) items.push({ title, link, source, pubDate: pub });
  }
  return items;
}

async function handleNews(url: URL): Promise<Response> {
  const region = url.searchParams.get("region") || "caricom";
  const feeds = FEEDS[region];
  if (!feeds) return json({ error: "Unknown region" }, 400);

  const data = await cached(`news:${region}`, 20 * 60 * 1000, async () => {
    const settled = await Promise.allSettled(
      feeds.map(async (f) => {
        const r = await fetchWithTimeout(f.url, 15000);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return parseRss(await r.text(), f.source);
      })
    );
    const seen = new Set<string>();
    const merged: NewsItem[] = [];
    for (const s of settled) {
      if (s.status !== "fulfilled") continue;
      for (const item of s.value) {
        if (seen.has(item.link)) continue;
        seen.add(item.link);
        merged.push(item);
      }
    }
    merged.sort((a, b) => {
      const ta = Date.parse(a.pubDate) || 0;
      const tb = Date.parse(b.pubDate) || 0;
      return tb - ta;
    });
    return {
      region,
      label: REGION_LABELS[region],
      items: merged.slice(0, 15),
      updated: new Date().toISOString(),
    };
  });
  return json(data);
}

// ---------------------------------------------------------------------------
// ClickUp tasks (outstanding only)
// ---------------------------------------------------------------------------

const DONE_RE = /complete|done|closed/i;

async function fetchTasksDirect(token: string, listId: string): Promise<any[]> {
  const tasks: any[] = [];
  let page = 0;
  for (;;) {
    const r = await fetchWithTimeout(
      `https://api.clickup.com/api/v2/list/${listId}/task?archived=false&page=${page}`,
      20000,
      { headers: { Authorization: token } }
    );
    if (r.status === 401) throw new Error("ClickUp rejected the token (401)");
    if (!r.ok) throw new Error(`ClickUp HTTP ${r.status}`);
    const body: any = await r.json();
    tasks.push(...(body.tasks || []));
    if (body.last_page !== false) break;
    page++;
    if (page > 20) break;
  }
  return tasks;
}

async function fetchTasksViaSkill(listId: string): Promise<any[]> {
  const cli = `${process.env.HOME}/workspace/skills/clickup/bin/clickup_tasks.py`;
  const file = await Bun.file(cli).exists();
  if (!file) throw new Error("no ClickUp credential available");
  const out = `/tmp/briefing-tasks-${Date.now()}.json`;
  const proc = Bun.spawn(["python3", cli, "--list", listId, "--out", out], {
    stdout: "pipe",
    stderr: "pipe",
  });
  // The skill may wait on a credential approval; don't hang the request forever.
  const exited = await Promise.race([proc.exited, Bun.sleep(60000).then(() => "timeout" as const)]);
  if (exited === "timeout" || exited !== 0) {
    proc.kill();
    const err = await new Response(proc.stderr).text().catch(() => "");
    throw new Error(err.trim() || "task fetch timed out — set CLICKUP_TOKEN to skip the skill helper");
  }
  const data = await Bun.file(out).json();
  await Bun.file(out).unlink().catch(() => {});
  return data.tasks || [];
}

const PRIO_BY_ID: Record<string, string> = { 1: "urgent", 2: "high", 3: "normal", 4: "low" };

async function handleTasks(): Promise<Response> {
  const data = await cached("tasks", 10 * 60 * 1000, async () => {
    const listId = process.env.CLICKUP_LIST_ID || "901418249044";
    const token = process.env.CLICKUP_TOKEN || "";
    let raw: any[];
    try {
      raw = token ? await fetchTasksDirect(token, listId) : await fetchTasksViaSkill(listId);
    } catch (e: any) {
      return { error: e.message || "task fetch failed", tasks: [], count: 0, total: 0 };
    }
    const normalized = raw.map((t: any) => {
      const prio = t.priority || {};
      let priority: string;
      if (typeof t.priority === "string") {
        priority = PRIO_BY_ID[t.priority] || t.priority.toLowerCase();
      } else {
        priority = PRIO_BY_ID[String(prio.id || "")] || String(prio.priority || "normal").toLowerCase();
      }
      let due = "", due_iso = "";
      const rawDue = t.due_date || t.due_iso;
      if (rawDue) {
        const ms = /^\d+$/.test(String(rawDue)) ? Number(rawDue) : Date.parse(rawDue);
        if (!Number.isNaN(ms)) {
          const d = new Date(ms);
          due_iso = d.toISOString();
          due = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase();
        }
      }
      return {
        name: t.name || "",
        status: (t.status && t.status.status) || t.status || "",
        priority: ["urgent", "high", "normal", "low"].includes(priority) ? priority : "normal",
        due,
        due_iso,
      };
    });
    const outstanding = normalized.filter((t) => !DONE_RE.test(t.status));
    return { tasks: outstanding, count: outstanding.length, total: normalized.length, listId };
  });
  return json(data);
}

// ---------------------------------------------------------------------------
// headline mood: fear vs hope (lexicon scoring)
// ---------------------------------------------------------------------------

const FEAR_WORDS = new Set(
  ("fear fears feared fearful threat threats threatened threatening crisis wars warfare " +
    "attack attacks attacked attacker deadly dead death deaths kill killed killing kills " +
    "warning warnings warn warned risk risks risky danger dangerous collapse collapsed collapsing " +
    "panic panicked terror terrorist terrorists terrorism terrified terrifying crash crashed crashing " +
    "emergency alarm alarming alarmed dread dreaded catastrophe catastrophic disaster disastrous " +
    "violence violent violently outbreak shortage shortages recession inflation doom doomed " +
    "nightmare horror horrible hostage hostages missile missiles bomb bombs bombing bombings " +
    "sanction sanctions conflict conflicts clash clashes clashed unrest riot riots evacuate " +
    "evacuated evacuation evacuations casualty casualties wounded airstrike airstrikes invasion " +
    "invade invaded nuclear meltdown hack hacked hacking breach breached scam scams fraud " +
    "fraudulent lawsuit probe probed scandal scandals corrupt corruption bankrupt bankruptcy " +
    "layoffs plague epidemic pandemic famine drought flood floods flooding wildfire wildfires " +
    "earthquake hurricane tornado slaughter massacre kidnapped kidnapping assault murder " +
    "murdered suicide poison toxic lethal fatal fatalities grim bleak dire desperate desperation " +
    "chaos chaotic turmoil upheaval crackdown siege besieged coup curfew banned expel expelled " +
    "deport tariff tariffs").split(" ")
);

const HOPE_WORDS = new Set(
  ("hope hopes hoped hopeful breakthrough breakthroughs success successes successful " +
    "successfully win wins won winning winner progress peaceful peace recovery recovered " +
    "recovering growth growing grown record records celebrate celebrated celebrates celebration " +
    "optimistic optimism solution solutions solve solved solving launch launches launched " +
    "launching discover discovered discovers discovery discoveries cure cured cures rescue " +
    "rescued rescues thrive thriving thrives milestone milestones promise promises promised " +
    "promising bright brighter advance advances advanced advancing advancement innovation " +
    "innovations innovative boom booming rally rallied rallies surging surge surged triumph " +
    "triumphant victory victories victorious heal healed healing heals rebuild rebuilt " +
    "rebuilding unite united uniting unity cooperation deal deals agreement agreements agreed " +
    "approve approved approval save saved saving relief relieved comeback revive revived " +
    "revival flourish flourishing prosper prosperity prosperous uplift uplifting inspire " +
    "inspired inspiring inspiration hero heroes heroic generous generosity donate donated " +
    "charity kindness compassion mercy freedom liberty").split(" ")
);

const NEGATORS = new Set(
  ["not", "no", "never", "neither", "none", "without", "cannot", "can't", "won't",
   "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "couldn't",
   "shouldn't", "wouldn't", "hasn't", "haven't", "hadn't"]
);

// pessimism / optimism: tuned for tech headlines (Hacker News)
const PESSIMISM_WORDS = new Set(
  ("doom doomed gloom gloomy dying dead decline declines declining declined fail fails " +
    "failed failing failure failures broken obsolete deprecated abandoned abandon sunset " +
    "sunsetted killed worst terrible terribly awful dreadful bleak grim dire dystopia " +
    "dystopian enshittification collapse collapsed collapsing crash crashed crashing crisis " +
    "bubble burst overhyped layoffs fired firing pessimistic pessimism skeptical skepticism " +
    "doubt doubts doubtful doubting uncertain uncertainty fragile fragility flawed flaw " +
    "flaws bug bugs buggy slow slower slowest expensive costly overpriced waste wasted " +
    "wasteful pointless useless scam scams fraud monopoly monopolistic stagnation stagnant " +
    "surveillance creepy invasive").split(" ")
);

const OPTIMISM_WORDS = new Set(
  ("optimistic optimism exciting excited excitement promising promise future futuristic " +
    "breakthrough amazing incredible awesome love loved great greatest best fantastic " +
    "wonderful impressive impressed beautiful elegant fast faster fastest cheap cheaper " +
    "cheapest open openness democratize empowered empowering potential opportunity " +
    "opportunities progress innovative innovation revolution revolutionary delightful fun " +
    "cool neat clever brilliant genius milestone success successful thriving boom golden " +
    "renaissance shipped shipping launched launch release released debut fix fixed fixes " +
    "solve solved free").split(" ")
);

interface Spectrum {
  id: string;
  label: string; // "fear ↔ hope"
  negLabel: string;
  posLabel: string;
  negEmoji: string;
  posEmoji: string;
  negWords: Set<string>;
  posWords: Set<string>;
}

const FEAR_HOPE: Spectrum = {
  id: "fear-hope",
  label: "fear ↔ hope",
  negLabel: "fear",
  posLabel: "hope",
  negEmoji: "😨",
  posEmoji: "🌱",
  negWords: FEAR_WORDS,
  posWords: HOPE_WORDS,
};

const PESSIMISM_OPTIMISM: Spectrum = {
  id: "pessimism-optimism",
  label: "pessimism ↔ optimism",
  negLabel: "pessimism",
  posLabel: "optimism",
  negEmoji: "📉",
  posEmoji: "📈",
  negWords: PESSIMISM_WORDS,
  posWords: OPTIMISM_WORDS,
};

interface ScoredHeadline {
  title: string;
  link: string;
  source: string;
  spectrum: string;
  negEmoji: string;
  posEmoji: string;
  neg: number;
  pos: number;
  index: number; // -100 (negative pole) .. +100 (positive pole)
  negWords: string[];
  posWords: string[];
}

function scoreHeadline(title: string, link: string, source: string, sp: Spectrum): ScoredHeadline {
  const tokens = title
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let neg = 0;
  let pos = 0;
  const negHits: string[] = [];
  const posHits: string[] = [];
  tokens.forEach((raw, i) => {
    const word = raw.replace(/^'+|'+$/g, "");
    let kind: "neg" | "pos" | null = null;
    if (sp.negWords.has(word)) kind = "neg";
    else if (sp.posWords.has(word)) kind = "pos";
    if (!kind) return;
    const prev = tokens.slice(Math.max(0, i - 2), i).map((t) => t.replace(/^'+|'+$/g, ""));
    const negated = prev.some((t) => NEGATORS.has(t) || t.endsWith("n't"));
    if (negated) kind = kind === "neg" ? "pos" : "neg";
    if (kind === "neg") {
      neg++;
      negHits.push(word);
    } else {
      pos++;
      posHits.push(word);
    }
  });
  const total = neg + pos;
  return {
    title,
    link,
    source,
    spectrum: sp.label,
    negEmoji: sp.negEmoji,
    posEmoji: sp.posEmoji,
    neg,
    pos,
    index: total === 0 ? 0 : Math.round((100 * (pos - neg)) / total),
    negWords: [...new Set(negHits)].slice(0, 5),
    posWords: [...new Set(posHits)].slice(0, 5),
  };
}

interface MoodSummary {
  name: string;
  spectrum: string;
  negLabel: string;
  posLabel: string;
  negEmoji: string;
  posEmoji: string;
  count: number;
  index: number;
  negLeaning: number;
  posLeaning: number;
  neutral: number;
}

function summarizeMood(name: string, sp: Spectrum, scored: ScoredHeadline[]): MoodSummary {
  const n = scored.length;
  return {
    name,
    spectrum: sp.label,
    negLabel: sp.negLabel,
    posLabel: sp.posLabel,
    negEmoji: sp.negEmoji,
    posEmoji: sp.posEmoji,
    count: n,
    index: n ? Math.round(scored.reduce((s, x) => s + x.index, 0) / n) : 0,
    negLeaning: scored.filter((x) => x.index <= -20).length,
    posLeaning: scored.filter((x) => x.index >= 20).length,
    neutral: scored.filter((x) => x.index > -20 && x.index < 20).length,
  };
}

async function fetchHnHeadlines(): Promise<{ title: string; link: string }[]> {
  const r = await fetchWithTimeout(
    "https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=40"
  );
  if (!r.ok) throw new Error("HN fetch failed");
  const body: any = await r.json();
  return (body.hits || [])
    .filter((h: any) => h.title)
    .slice(0, 35)
    .map((h: any) => ({
      title: h.title,
      link: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
    }));
}

async function fetchGuardianHeadlines(): Promise<{ title: string; link: string }[]> {
  const r = await fetchWithTimeout("https://www.theguardian.com/world/rss");
  if (!r.ok) throw new Error("Guardian fetch failed");
  return parseRss(await r.text(), "The Guardian").slice(0, 25);
}

async function handleMood(): Promise<Response> {
  const data = await cached("mood", 30 * 60 * 1000, async () => {
    const [hn, guardian] = await Promise.all([
      fetchHnHeadlines().catch(() => []),
      fetchGuardianHeadlines().catch(() => []),
    ]);
    const hnScored = hn.map((h) => scoreHeadline(h.title, h.link, "Hacker News", PESSIMISM_OPTIMISM));
    const gScored = guardian.map((h) => scoreHeadline(h.title, h.link, "The Guardian", FEAR_HOPE));
    const all = [...hnScored, ...gScored];
    const byNeg = [...all].filter((x) => x.index < 0).sort((a, b) => a.index - b.index).slice(0, 3);
    const byPos = [...all].filter((x) => x.index > 0).sort((a, b) => b.index - a.index).slice(0, 3);
    const slim = (x: ScoredHeadline) => ({
      title: x.title,
      link: x.link,
      source: x.source,
      spectrum: x.spectrum,
      negEmoji: x.negEmoji,
      posEmoji: x.posEmoji,
      index: x.index,
      negWords: x.negWords,
      posWords: x.posWords,
    });
    return {
      sources: [
        summarizeMood("Hacker News", PESSIMISM_OPTIMISM, hnScored),
        summarizeMood("The Guardian", FEAR_HOPE, gScored),
      ],
      negative: byNeg.map(slim),
      positive: byPos.map(slim),
      updated: new Date().toISOString(),
    };
  });
  return json(data);
}

// ---------------------------------------------------------------------------
// static files + routes
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

async function serveStatic(path: string): Promise<Response | null> {
  const rel = path === "/" ? "/index.html" : path;
  if (rel.includes("..")) return null;
  const file = Bun.file(PUBLIC_DIR + rel);
  if (!(await file.exists())) return null;
  const ext = rel.slice(rel.lastIndexOf("."));
  return new Response(file, {
    headers: { "Content-Type": MIME[ext] || "application/octet-stream" },
  });
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 120,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/api/weather") return await handleWeather(url);
      if (url.pathname === "/api/news") return await handleNews(url);
      if (url.pathname === "/api/tasks") return await handleTasks();
      if (url.pathname === "/api/mood") return await handleMood();
      if (url.pathname === "/api/health") return json({ ok: true, time: new Date().toISOString() });
      const staticRes = await serveStatic(url.pathname);
      if (staticRes) return staticRes;
      return new Response("Not found", { status: 404 });
    } catch (e: any) {
      return json({ error: e.message || "internal error" }, 500);
    }
  },
});

console.log(`Morning briefing at http://localhost:${server.port}`);
