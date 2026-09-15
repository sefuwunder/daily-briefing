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
  let name = url.searchParams.get("name")?.trim() || "";
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
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto&forecast_days=6`
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
    latitude: Number(lat),
    longitude: Number(lon),
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
    sun: {
      sunrise: w.daily.sunrise[0],
      sunset: w.daily.sunset[0],
    },
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
  // global art/DIY tab — no regional headlines, just the arts block
  artdiy: [],
};

const REGION_LABELS: Record<string, string> = {
  caricom: "CARICOM",
  africa: "Africa",
  easteurope: "Eastern Europe",
  artdiy: "🎨 Art & DIY",
};

// indie / DIY / underground arts & culture feeds per region
const ARTS_FEEDS: Record<string, { source: string; url: string }[]> = {
  caricom: [
    { source: "LargeUp", url: "https://www.largeup.com/feed/" },
    { source: "Repeating Islands", url: "https://repeatingislands.com/feed/" },
    { source: "Caribbean Beat", url: "https://www.caribbean-beat.com/feed" },
    { source: "Maria Jackson 27", url: "https://mariajackson27magazine.com/feed/" },
    { source: "Ebuzztt", url: "https://ebuzztt.com/feed" },
  ],
  africa: [
    { source: "The NATIVE", url: "https://thenativemag.com/feed" },
    { source: "Music In Africa", url: "https://www.musicinafrica.net/feed" },
    { source: "ART AFRICA Magazine", url: "https://artafricamagazine.org/feed/" },
    { source: "Africa Is a Country", url: "https://africasacountry.com/feed" },
    { source: "Halmblog Music", url: "https://halmblog.com/feed" },
  ],
  easteurope: [
    { source: "Bird In Flight", url: "https://birdinflight.com/feed" },
    { source: "Lossi 36", url: "https://lossi36.com/feed/" },
    { source: "Kajet Journal", url: "https://kajetjournal.com/feed/" },
  ],
  // global underground art / DIY / net-art — Rhizome & e-flux kin
  // (both sites block feed fetching, so these are the closest working feeds;
  // the arts block links out to rhizome.org and e-flux.com directly)
  artdiy: [
    { source: "Neural", url: "https://neural.it/feed/" },
    { source: "Hyperallergic", url: "https://hyperallergic.com/feed/" },
    { source: "We Make Money Not Art", url: "https://we-make-money-not-art.com/feed/" },
    { source: "Furtherfield", url: "https://www.furtherfield.org/feed/" },
    { source: "DIY Conspiracy", url: "https://diyconspiracy.net/feed/" },
  ],
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
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
  description: string; // plain-text summary, used for geo filtering
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
    const desc =
      pick(body.match(/<description[^>]*>([\s\S]*?)<\/description>/i)) ||
      pick(body.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i));
    if (title && link) items.push({ title, link, source, pubDate: pub, description: desc });
  }
  return items;
}

async function loadFeedItems(
  feeds: { source: string; url: string }[],
  limit: number,
  filter?: (item: NewsItem) => boolean
): Promise<NewsItem[]> {
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
      if (filter && !filter(item)) continue;
      if (seen.has(item.link)) continue;
      seen.add(item.link);
      merged.push(item);
    }
  }
  merged.sort((a, b) => (Date.parse(b.pubDate) || 0) - (Date.parse(a.pubDate) || 0));
  return merged.slice(0, limit);
}

// ---------------------------------------------------------------------------
// geographic filtering for art items: keep only items related to the areas
// of interest (matched against title + description, word-boundary aware)
// ---------------------------------------------------------------------------

const ART_ITEMS_FILE = new URL("../data/art_items.json", import.meta.url).pathname;

interface CuratedArtItem extends NewsItem {
  regions: string[];
}

// Hand-picked arts items the RSS geo filter would miss (e.g. the region
// mention only appears in the full article, not the feed summary).
// Each entry is reviewed before being added; the file is merged into the
// arts arrays by the same region filter the feeds use.
async function loadCuratedArt(): Promise<CuratedArtItem[]> {
  try {
    const raw = await Bun.file(ART_ITEMS_FILE).json();
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

const REGION_KEYWORDS: Record<string, string[]> = {
  caricom: [
    "caribbean", "west indies", "caricom",
    "antigua", "barbuda", "bahamas", "barbados", "belize", "dominica",
    "grenada", "guyana", "haiti", "jamaica", "montserrat", "nevis",
    "suriname", "trinidad", "tobago",
    "saint kitts", "st kitts", "st. kitts",
    "saint lucia", "st lucia", "st. lucia",
    "saint vincent", "st vincent", "st. vincent",
    "jamaican", "barbadian", "bajan", "trinidadian", "tobagonian",
    "guyanese", "haitian", "bahamian", "grenadian",
    "kingston", "bridgetown", "port of spain", "port-au-prince", "nassau",
    "paramaribo", "castries", "roseau", "basseterre", "kingstown",
  ],
  africa: [
    "africa", "african",
    "algeria", "angola", "benin", "botswana", "burkina faso", "burundi",
    "cameroon", "cape verde", "cabo verde", "central african republic",
    "chad", "comoros", "congo", "djibouti", "egypt", "equatorial guinea",
    "eritrea", "eswatini", "ethiopia", "gabon", "gambia", "ghana", "guinea",
    "guinea-bissau", "ivory coast", "kenya", "lesotho", "liberia", "libya",
    "madagascar", "malawi", "mali", "mauritania", "mauritius", "morocco",
    "mozambique", "namibia", "niger", "nigeria", "rwanda", "senegal",
    "seychelles", "sierra leone", "somalia", "south africa", "south sudan",
    "sudan", "tanzania", "togo", "tunisia", "uganda", "zambia", "zimbabwe",
    "nigerian", "kenyan", "ghanaian", "ethiopian", "senegalese", "egyptian",
    "moroccan", "south african", "malian", "congolese",
    "lagos", "nairobi", "cairo", "johannesburg", "accra", "dakar",
    "kinshasa", "addis ababa", "abuja", "casablanca", "cape town",
    "dar es salaam", "abidjan",
  ],
  easteurope: [
    "eastern europe", "baltic", "balkans", "soviet",
    "ukraine", "ukrainian", "belarus", "belarusian", "moldova", "moldovan",
    "poland", "polish", "romania", "romanian", "hungary", "hungarian",
    "czechia", "czech", "slovakia", "slovak", "bulgaria", "bulgarian",
    "serbia", "serbian", "croatia", "croatian", "bosnia", "bosnian",
    "herzegovina", "albania", "albanian", "macedonia", "montenegro",
    "kosovo", "slovenia", "slovenian", "lithuania", "lithuanian",
    "latvia", "latvian", "estonia", "estonian",
    "kyiv", "kiev", "lviv", "odesa", "odessa", "warsaw", "krakow",
    "bucharest", "budapest", "prague", "belgrade", "sofia", "zagreb",
    "vilnius", "riga", "tallinn", "chisinau", "minsk", "sarajevo",
    "skopje", "tirana", "pristina",
  ],
};

const REGION_PATTERNS = new Map<string, RegExp>();
function regionPattern(region: string): RegExp {
  let p = REGION_PATTERNS.get(region);
  if (!p) {
    const alt = REGION_KEYWORDS[region]
      .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    p = new RegExp(`\\b(${alt})\\b`, "i");
    REGION_PATTERNS.set(region, p);
  }
  return p;
}

function matchesRegion(text: string, region: string): boolean {
  const kws = REGION_KEYWORDS[region];
  if (!kws) return false;
  return regionPattern(region).test(text);
}

async function handleNews(url: URL): Promise<Response> {
  const region = url.searchParams.get("region") || "caricom";
  const feeds = FEEDS[region];
  if (!feeds) return json({ error: "Unknown region" }, 400);

  const data = await cached(`news:${region}`, 20 * 60 * 1000, async () => {
    // art items are filtered to the geographic areas of interest; the global
    // art tab accepts items matching any of the three regions
    const artsRegions = region === "artdiy" ? ["caricom", "africa", "easteurope"] : [region];
    const artsFilter = (item: NewsItem) =>
      artsRegions.some((r) => matchesRegion(`${item.title} ${item.description}`, r));
    const [items, feedArts] = await Promise.all([
      loadFeedItems(feeds, 15),
      // the global art tab has no regional headlines — give its feeds more room
      loadFeedItems(ARTS_FEEDS[region] || [], region === "artdiy" ? 16 : 8, artsFilter),
    ]);
    // merge in hand-picked art items, newest first, without duplicating feed links
    const curated = (await loadCuratedArt()).filter(
      (c) => c.regions.some((r) => artsRegions.includes(r)) && artsFilter(c)
    );
    const seenLinks = new Set(feedArts.map((a) => a.link));
    const arts = [...curated.filter((c) => !seenLinks.has(c.link)), ...feedArts];
    return {
      region,
      label: REGION_LABELS[region],
      items,
      arts,
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
    "nightmare horror horrible hell hostage hostages missile missiles bomb bombs bombing bombings " +
    "sanction sanctions conflict conflicts clash clashes clashed unrest riot riots evacuate " +
    "evacuated evacuation evacuations casualty casualties wounded airstrike airstrikes invasion " +
    "invade invaded nuclear meltdown hack hacked hacking breach breached scam scams fraud " +
    "fraudulent lawsuit probe probed scandal scandals corrupt corruption bankrupt bankruptcy " +
    "layoffs plague epidemic pandemic famine drought flood floods flooding wildfire wildfires " +
    "earthquake hurricane tornado slaughter massacre kidnapped kidnapping assault murder " +
    "murdered suicide poison toxic lethal fatal fatalities grim bleak dire desperate desperation " +
    "chaos chaotic turmoil upheaval crackdown siege besieged coup curfew banned expel expelled " +
    // 2026-09-14: fugitive (research candidate — appeared twice, not excluded)
    // 2026-09-15: missing (research candidate — appeared twice in disaster headlines, not excluded)
    "deport tariff tariffs fugitive missing").split(" ")
);

// Graded intensity tiers (Reagan et al. 2017: continuum-scored words beat
// binary valence). 1 = mild, 2 = strong (default for unlisted words),
// 3 = extreme. research.py parses only the Set(...) blocks above, so these
// tables are invisible to it.
const FEAR_INTENSITY: Record<string, number> = {
  // extreme: death, catastrophe, existential threat
  deadly: 3, dead: 3, death: 3, deaths: 3, kill: 3, killed: 3, killing: 3, kills: 3,
  terror: 3, terrorist: 3, terrorists: 3, terrorism: 3,
  catastrophe: 3, catastrophic: 3, disaster: 3, disastrous: 3,
  nightmare: 3, horror: 3, hell: 3,
  missile: 3, missiles: 3, bomb: 3, bombs: 3, bombing: 3, bombings: 3,
  airstrike: 3, airstrikes: 3, invasion: 3, invade: 3, invaded: 3,
  nuclear: 3, meltdown: 3, plague: 3, epidemic: 3, pandemic: 3, famine: 3,
  slaughter: 3, massacre: 3, kidnapped: 3, kidnapping: 3,
  murder: 3, murdered: 3, suicide: 3, poison: 3, lethal: 3, fatal: 3, fatalities: 3,
  earthquake: 3, hurricane: 3, tornado: 3, wildfire: 3, wildfires: 3,
  // mild: hedged, procedural, or low-affect
  warning: 1, warnings: 1, warn: 1, warned: 1,
  risk: 1, risks: 1, risky: 1,
  alarm: 1, alarming: 1, alarmed: 1,
  shortage: 1, shortages: 1, inflation: 1,
  sanction: 1, sanctions: 1, tariff: 1, tariffs: 1,
  lawsuit: 1, probe: 1, probed: 1, scandal: 1, scandals: 1,
  expel: 1, expelled: 1, banned: 1, curfew: 1, deport: 1,
  hack: 1, hacked: 1, hacking: 1, breach: 1, breached: 1, scam: 1, scams: 1,
  missing: 1,
};

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

const HOPE_INTENSITY: Record<string, number> = {
  // extreme: rare, transformative wins
  breakthrough: 3, breakthroughs: 3, triumph: 3, triumphant: 3,
  victory: 3, victories: 3, victorious: 3, cure: 3, cured: 3, cures: 3,
  // mild: soft or routine positives
  hope: 1, hopes: 1, hoped: 1, hopeful: 1,
  promise: 1, promises: 1, promised: 1, promising: 1,
  bright: 1, brighter: 1,
  approve: 1, approved: 1, approval: 1,
  deal: 1, deals: 1, agreement: 1, agreements: 1, agreed: 1,
  launch: 1, launches: 1, launched: 1, launching: 1,
  record: 1, records: 1,
};

const NEGATORS = new Set(
  ["not", "no", "never", "neither", "none", "without", "cannot", "can't", "won't",
   "isn't", "aren't", "wasn't", "weren't", "don't", "doesn't", "didn't", "couldn't",
   "shouldn't", "wouldn't", "hasn't", "haven't", "hadn't"]
);

// 2026-09-15: resolution words — the worst is over. A fear hit in a headline
// containing one of these ("outbreak has peaked") is good news, so neutralize
// it the way negators do. Scoped to the fear pole of the fear↔hope spectrum.
const RESOLUTION_WORDS = new Set(["peaked", "slowing", "easing"]);

// Reviewed and rejected as mood signals: topic words that drift with the
// news cycle rather than carrying stable affect.
// 2026-09-11: fire, ukraine, case, finds.
// 2026-09-12: google, programming, show, engine, visits, trump, see, ireland, sweden.
// 2026-09-13: happened (the "as it happened" live-blog marker).
const EXCLUDED_WORDS = new Set([
  "fire", "ukraine", "case", "finds",
  "google", "programming", "show", "engine", "visits", "trump", "see", "ireland", "sweden",
  "happened",
]);

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

const PESSIMISM_INTENSITY: Record<string, number> = {
  // extreme
  doom: 3, doomed: 3, dying: 3, dead: 3, killed: 3, dystopia: 3, dystopian: 3,
  // mild
  skeptical: 1, skepticism: 1, doubt: 1, doubts: 1, doubtful: 1, doubting: 1,
  uncertain: 1, uncertainty: 1, fragile: 1, fragility: 1,
  slow: 1, slower: 1, slowest: 1, expensive: 1, costly: 1, overpriced: 1,
};

const OPTIMISM_WORDS = new Set(
  ("optimistic optimism exciting excited excitement promising promise future futuristic " +
    "breakthrough amazing incredible awesome love loved great greatest best fantastic " +
    "wonderful impressive impressed beautiful elegant faster fastest cheap cheaper " +
    "cheapest open openness democratize empowered empowering potential opportunity " +
    "opportunities progress innovative innovation revolution revolutionary delightful fun " +
    "cool neat clever brilliant genius milestone success successful thriving boom golden " +
    "renaissance shipped shipping launched launch release released debut fix fixed fixes " +
    "solve solved free trust trusted").split(" ")
);

const OPTIMISM_INTENSITY: Record<string, number> = {
  // extreme
  breakthrough: 3, revolution: 3, revolutionary: 3,
  // mild
  promising: 1, promise: 1, cool: 1, neat: 1, fun: 1,
  cheap: 1, cheaper: 1, cheapest: 1, free: 1,
  // 2026-09-15: "fast" removed from the lexicon — it fired on neutral tech
  // headlines ("Fast Tokio Applications"), carrying no real optimism signal.
  faster: 1, fastest: 1,
};

interface Spectrum {
  id: string;
  label: string; // "fear ↔ hope"
  negLabel: string;
  posLabel: string;
  negEmoji: string;
  posEmoji: string;
  negWords: Set<string>;
  posWords: Set<string>;
  negIntensity: Record<string, number>; // per-word tiers; unlisted words default to 2
  posIntensity: Record<string, number>;
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
  negIntensity: FEAR_INTENSITY,
  posIntensity: HOPE_INTENSITY,
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
  negIntensity: PESSIMISM_INTENSITY,
  posIntensity: OPTIMISM_INTENSITY,
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
  let hits = 0;
  const negHits: string[] = [];
  const posHits: string[] = [];
  // 2026-09-15: a resolution word anywhere in the headline ("outbreak has
  // peaked") means the fear is receding — neutralize fear-pole hits.
  const resolving =
    sp.id === "fear-hope" &&
    tokens.some((t) => RESOLUTION_WORDS.has(t.replace(/^'+|'+$/g, "")));
  tokens.forEach((raw, i) => {
    const word = raw.replace(/^'+|'+$/g, "");
    if (EXCLUDED_WORDS.has(word)) return;
    let kind: "neg" | "pos" | null = null;
    if (sp.negWords.has(word)) kind = "neg";
    else if (sp.posWords.has(word)) kind = "pos";
    if (!kind) return;
    const prev = tokens.slice(Math.max(0, i - 2), i).map((t) => t.replace(/^'+|'+$/g, ""));
    const negated = prev.some((t) => NEGATORS.has(t) || t.endsWith("n't"));
    // Negators neutralize valence rather than flipping polarity
    // (Polanyi & Zaenen 2006: "not a failure" is neutral, not positive).
    // Resolution words neutralize fear hits the same way.
    if (negated) return;
    if (kind === "neg" && resolving) return;
    // Graded intensities: a strong word outweighs a mild one
    // (Reagan et al. 2017: continuum-scored words beat binary valence).
    if (kind === "neg") {
      neg += sp.negIntensity[word] ?? 2;
      negHits.push(word);
    } else {
      pos += sp.posIntensity[word] ?? 2;
      posHits.push(word);
    }
    hits++;
  });
  const total = neg + pos;
  const raw = total === 0 ? 0 : Math.round((100 * (pos - neg)) / total);
  // A single matched word swings the full ±100; cap at ±50 to cut day-to-day noise.
  const index = hits === 1 ? Math.max(-50, Math.min(50, raw)) : raw;
  return {
    title,
    link,
    source,
    spectrum: sp.label,
    negEmoji: sp.negEmoji,
    posEmoji: sp.posEmoji,
    neg,
    pos,
    index,
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
