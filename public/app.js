// Morning Briefing frontend
const $ = (id) => document.getElementById(id);

const state = {
  city: localStorage.getItem("briefing_city") || "",
  newsRegion: "caricom",
  geo: null,       // { lat, lon, name } from IP geolocation
  geoTried: false, // only hit the IP lookup once per page load
};

// ---- bookmarks (localStorage reading list) ----
const BM_KEY = "briefing_bookmarks";
const BM_OPEN_KEY = "briefing_bm_open";
function getBookmarks() {
  try { return JSON.parse(localStorage.getItem(BM_KEY)) || []; }
  catch { return []; }
}
function saveBookmarks(bm) {
  try { localStorage.setItem(BM_KEY, JSON.stringify(bm.slice(0, 100))); } catch {}
}
function isBookmarked(link) {
  return getBookmarks().some((b) => b.link === link);
}
function toggleBookmark(entry) {
  const bm = getBookmarks();
  const i = bm.findIndex((b) => b.link === entry.link);
  if (i >= 0) bm.splice(i, 1);
  else bm.unshift({ title: entry.title, link: entry.link, source: entry.source, savedAt: Date.now() });
  saveBookmarks(bm);
  renderBookmarks();
}
function setBmBtn(btn, on) {
  btn.classList.toggle("saved", on);
  btn.textContent = on ? "★" : "☆";
  btn.title = on ? "Remove bookmark" : "Bookmark this story";
  btn.setAttribute("aria-pressed", String(on));
}

// ---- daypart heading + theme ----
const DAYPARTS = {
  morning:   { emoji: "☀️", title: "Morning Briefing",   greet: "Good morning" },
  afternoon: { emoji: "🌤️", title: "Afternoon Briefing", greet: "Good afternoon" },
  evening:   { emoji: "🌆", title: "Evening Briefing",   greet: "Good evening" },
  night:     { emoji: "🌙", title: "Night Briefing",     greet: "Good night" },
};

function daypart() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

function applyDaypart() {
  const dp = daypart();
  const m = DAYPARTS[dp];
  document.body.dataset.daypart = dp; // drives the theme in styles.css
  document.title = m.title;
  $("briefing-title").innerHTML = `${m.emoji} ${m.title}`;
  renderDateline();
}

// ---- header ----
function renderDateline() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  $("dateline").textContent = `${DAYPARTS[daypart()].greet} — ${date}`;
}

// ---- weather ----
async function detectGeo() {
  // Approximate location from the viewer's IP (no key, no signup).
  try {
    const r = await fetch("https://ipapi.co/json/");
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.latitude || !j.longitude) return null;
    const name = [j.city, j.country_name].filter(Boolean).join(", ");
    return { lat: j.latitude, lon: j.longitude, name: name || "Current location" };
  } catch {
    return null;
  }
}

async function weatherUrl() {
  if (state.city) return `/api/weather?city=${encodeURIComponent(state.city)}`;
  if (!state.geoTried) {
    state.geoTried = true;
    state.geo = await detectGeo();
  }
  if (state.geo) {
    return `/api/weather?lat=${state.geo.lat}&lon=${state.geo.lon}` +
      `&name=${encodeURIComponent(state.geo.name)}`;
  }
  return `/api/weather?city=${encodeURIComponent("New York")}`; // last-resort fallback
}

async function loadWeather() {
  const body = $("weather-body");
  try {
    const r = await fetch(await weatherUrl());
    const w = await r.json();
    if (!r.ok) throw new Error(w.error || "weather failed");
    const c = w.current;
    const days = w.daily.map((d) => {
      const label = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      return `<div class="wx-day"><div class="d">${label}</div><div class="i">${d.icon}</div>
        <div class="t">${d.high_c}° <span>${d.low_c}°</span></div></div>`;
    }).join("");
    const geoNote = (!state.city && state.geo)
      ? `<br><span style="font-size:12px">📍 approximate location from your IP</span>` : "";
    body.innerHTML = `
      <div class="wx-now">
        <div class="wx-icon">${c.icon}</div>
        <div>
          <div class="wx-temp">${c.temp_c}°<small>C</small></div>
          <div class="wx-meta"><strong>${w.place}</strong><br>
          ${c.description} · feels like ${c.feels_c}°<br>
          💧 ${c.humidity}% · 💨 ${c.wind_kph} km/h${geoNote}</div>
        </div>
      </div>
      <div class="wx-days">${days}</div>
      <div class="sky" id="sky-body" aria-label="Sun and moon tracker"></div>`;
    renderSky(w.sun);
  } catch (e) {
    body.innerHTML = `<p class="error">Couldn't load weather: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- sun & moon tracker ----
const SYNODIC_MONTH = 29.530588853; // days
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14); // a known new moon
let skyTimer = null;
let moonIconSeq = 0;

function moonPhase(date) {
  const days = (date.getTime() - REF_NEW_MOON) / 86400000;
  const p = ((((days % SYNODIC_MONTH) + SYNODIC_MONTH) % SYNODIC_MONTH)) / SYNODIC_MONTH;
  const illum = Math.round(((1 - Math.cos(2 * Math.PI * p)) / 2) * 100);
  const names = ["New Moon", "Waxing Crescent", "First Quarter", "Waxing Gibbous",
                 "Full Moon", "Waning Gibbous", "Last Quarter", "Waning Crescent"];
  return { phase: p, illum, name: names[Math.floor(p * 8 + 0.5) % 8] };
}

// Moon disc with a geometrically correct terminator: the lit limb is on the
// right while waxing, on the left while waning; the terminator bulges toward
// the lit side for crescents and away for gibbous phases.
function moonIcon(p, size) {
  const R = 15, C = 20;
  const q = 2 * Math.PI * p;
  const rx = Math.max(0.4, R * Math.abs(Math.cos(q)));
  const waxing = p < 0.5;
  const crescent = Math.cos(q) > 0;
  const limbSweep = waxing ? 1 : 0;
  const termSweep = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
  const id = "mpi" + (++moonIconSeq);
  return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" aria-hidden="true">` +
    `<defs><clipPath id="${id}"><path d="M ${C} ${C - R} ` +
    `A ${R} ${R} 0 0 ${limbSweep} ${C} ${C + R} ` +
    `A ${rx.toFixed(2)} ${R} 0 0 ${termSweep} ${C} ${C - R} Z"/></clipPath></defs>` +
    `<circle cx="${C}" cy="${C}" r="${R}" fill="#454b5c"/>` +
    `<circle cx="${C}" cy="${C}" r="${R}" fill="#f2eee1" clip-path="url(#${id})"/></svg>`;
}

function fmtSunTime(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "—" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function renderSky(sun) {
  const host = $("sky-body");
  if (skyTimer) { clearInterval(skyTimer); skyTimer = null; }
  if (!host || !sun || !sun.sunrise || !sun.sunset) return;
  const sr = new Date(sun.sunrise), ss = new Date(sun.sunset);
  if (isNaN(sr) || isNaN(ss) || ss <= sr) return;

  let stars = "";
  for (let i = 0; i < 36; i++) {
    const x = (Math.random() * 300).toFixed(1), y = (Math.random() * 108).toFixed(1);
    const r = (0.6 + Math.random() * 1.1).toFixed(2);
    stars += `<circle class="star" cx="${x}" cy="${y}" r="${r}" style="animation-delay:${(Math.random() * 4).toFixed(2)}s"/>`;
  }
  host.innerHTML = `
    <svg class="sky-svg" viewBox="0 0 300 168" role="img" aria-label="Sun and moon arc">
      <defs>
        <linearGradient id="skyday" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#6ea8e8"/><stop offset="1" stop-color="#f7dcaa"/>
        </linearGradient>
        <linearGradient id="skynight" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#0a0f24"/><stop offset="1" stop-color="#2c3d63"/>
        </linearGradient>
        <radialGradient id="sunglow">
          <stop offset="0" stop-color="#fff3c4" stop-opacity=".85"/><stop offset="1" stop-color="#ffd94d" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="moonglow">
          <stop offset="0" stop-color="#dfe6ff" stop-opacity=".5"/><stop offset="1" stop-color="#dfe6ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="300" height="168" fill="url(#skyday)"/>
      <rect class="night-sky" width="300" height="168" fill="url(#skynight)" opacity="0"/>
      <g class="stars" opacity="0">${stars}</g>
      <path d="M 20 148 A 130 130 0 0 1 280 148" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="1.5" stroke-dasharray="5 5"/>
      <line x1="6" y1="148" x2="294" y2="148" stroke="rgba(255,255,255,.55)" stroke-width="1.5"/>
      <g class="orb sun-orb"><circle class="halo" r="26" fill="url(#sunglow)"/><circle r="11" fill="#ffd94d"/></g>
      <g class="orb moon-orb"><circle r="20" fill="url(#moonglow)"/><circle r="9" fill="#e9e4d6"/></g>
    </svg>
    <div class="sky-times">
      <span>🌅 <b class="sky-sr"></b></span>
      <span class="sky-now muted"></span>
      <span><b class="sky-ss"></b> 🌇</span>
    </div>
    <div class="sky-moon"><span class="sky-moon-icon"></span><span class="sky-moon-label"></span></div>`;

  host.querySelector(".sky-sr").textContent = fmtSunTime(sun.sunrise);
  host.querySelector(".sky-ss").textContent = fmtSunTime(sun.sunset);
  const mp = moonPhase(new Date());
  host.querySelector(".sky-moon-icon").innerHTML = moonIcon(mp.phase, 30);
  host.querySelector(".sky-moon-label").textContent = `${mp.name} · ${mp.illum}% lit`;

  const CX = 150, CY = 148, R = 130;
  const dayMs = ss - sr, nightMs = 86400000 - dayMs, twilightMs = 30 * 60000;
  const place = (orb, frac) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, frac)));
    orb.setAttribute("transform", `translate(${(CX + R * Math.cos(a)).toFixed(1)} ${(CY - R * Math.sin(a)).toFixed(1)})`);
  };
  const tick = () => {
    const now = new Date();
    const isDay = now >= sr && now <= ss;
    const sunOrb = host.querySelector(".sun-orb"), moonOrb = host.querySelector(".moon-orb");
    const nightSky = host.querySelector(".night-sky"), starsG = host.querySelector(".stars");
    const nowLabel = host.querySelector(".sky-now");
    let dayness;
    if (isDay) {
      place(sunOrb, (now - sr) / dayMs);
      sunOrb.style.display = ""; moonOrb.style.display = "none";
      dayness = 1;
      nowLabel.textContent = `☀️ up · sets ${fmtSunTime(sun.sunset)}`;
    } else {
      let sinceSs = now - ss;
      if (sinceSs < 0) sinceSs += 86400000; // after midnight, before sunrise
      place(moonOrb, sinceSs / nightMs);
      moonOrb.style.display = ""; sunOrb.style.display = "none";
      const toRise = (sr - now + 86400000) % 86400000;
      dayness = Math.max(0, 1 - Math.min(toRise, sinceSs) / twilightMs);
      nowLabel.textContent = `🌙 up · rises ${fmtSunTime(sun.sunrise)}`;
    }
    nightSky.setAttribute("opacity", (1 - dayness).toFixed(2));
    starsG.setAttribute("opacity", (1 - dayness).toFixed(2));
  };
  tick();
  skyTimer = setInterval(tick, 30000);
}

// ---- tasks ----
function dueInfo(task) {
  if (!task.due_iso) return "";
  const due = new Date(task.due_iso);
  const now = new Date();
  const days = Math.ceil((due - now) / 86400000);
  const label = task.due || due.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  if (days < 0) return `<span class="pill due-soon">overdue</span><span>due ${label}</span>`;
  if (days <= 2) return `<span class="pill due-soon">due ${label}</span>`;
  return `<span>due ${label}</span>`;
}

async function loadTasks() {
  const body = $("tasks-body");
  try {
    const r = await fetch("/api/tasks");
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || "tasks failed");
    $("task-count").textContent = data.count === 1 ? "1 open" : `${data.count} open`;
    if (!data.tasks.length) {
      body.innerHTML = `<p class="muted">🎉 Nothing outstanding. Enjoy the day.</p>`;
      return;
    }
    body.innerHTML = `<div class="task-list">` + data.tasks.map((t) => `
      <div class="task">
        <span class="dot ${t.priority}"></span>
        <div>
          <div class="name">${escapeHtml(t.name)}</div>
          <div class="sub"><span class="pill">${escapeHtml(t.status)}</span>
            <span>${t.priority}</span>${dueInfo(t)}</div>
        </div>
      </div>`).join("") + `</div>`;
  } catch (e) {
    $("task-count").textContent = "";
    body.innerHTML = `<p class="error">Couldn't load tasks: ${escapeHtml(e.message)}</p>
      <p class="muted" style="font-size:13px">Set <code>CLICKUP_TOKEN</code> and <code>CLICKUP_LIST_ID</code>
      in your <code>.env</code>, then restart the server.</p>`;
  }
}

// ---- news ----
function timeAgo(iso) {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 0) return "";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function loadNews() {
  const body = $("news-body");
  body.innerHTML = `<p class="muted">Loading headlines…</p>`;
  try {
    const r = await fetch(`/api/news?region=${state.newsRegion}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "news failed");
    if (!data.items.length && !(data.arts && data.arts.length)) {
      body.innerHTML = `<p class="muted">No headlines right now.</p>`;
      return;
    }
    const storyHtml = (s) => {
      const saved = isBookmarked(s.link);
      return `
      <div class="story-row">
        <a class="story" href="${escapeAttr(s.link)}" target="_blank" rel="noopener">
          <div class="story-title">${escapeHtml(s.title)}</div>
          <div class="story-meta"><span class="src">${escapeHtml(s.source)}</span>
            <span>${timeAgo(s.pubDate)}</span></div>
        </a>
        <button class="bm-btn${saved ? " saved" : ""}" data-link="${escapeAttr(s.link)}"
          data-title="${escapeAttr(s.title)}" data-source="${escapeAttr(s.source)}"
          title="${saved ? "Remove bookmark" : "Bookmark this story"}"
          aria-label="Bookmark this story" aria-pressed="${saved}">${saved ? "★" : "☆"}</button>
      </div>`;
    };
    const artsHtml = (data.arts && data.arts.length)
      ? `<h3 class="arts-head">🎨 Underground arts &amp; culture</h3>` +
        data.arts.map(storyHtml).join("") +
        `<p class="arts-more muted">More DIY &amp; net-art inspiration:
          <a href="https://rhizome.org" target="_blank" rel="noopener">Rhizome</a> ·
          <a href="https://www.e-flux.com" target="_blank" rel="noopener">e-flux</a></p>`
      : "";
    body.innerHTML = data.items.map(storyHtml).join("") + artsHtml;
    body.classList.remove("swap-in");
    void body.offsetWidth; // restart the fade each time headlines render
    body.classList.add("swap-in");
    $("updated").textContent =
      `News updated ${new Date(data.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  } catch (e) {
    body.innerHTML = `<p class="error">Couldn't load headlines: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- mood ----
function moodClass(i) {
  return i <= -20 ? "neg" : i >= 20 ? "pos" : "neutral";
}

async function loadMood() {
  const body = $("mood-body");
  try {
    const r = await fetch("/api/mood");
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "mood failed");

    const srcHtml = data.sources.map((s) => {
      const cls = moodClass(s.index);
      const w = Math.min(50, Math.abs(s.index) / 2);
      const fill = s.index < 0
        ? `<div class="fill-fear" style="width:${w}%"></div>`
        : `<div class="fill-hope" style="width:${w}%"></div>`;
      const sign = s.index > 0 ? "+" : "";
      const emoji = s.index <= -20 ? s.negEmoji : s.index >= 20 ? s.posEmoji : "😐";
      return `<div class="mood-src">
        <div class="row"><div><div class="name">${escapeHtml(s.name)}</div>
            <div class="spectrum">${escapeHtml(s.spectrum)}</div></div>
          <span class="idx ${cls}">${emoji} ${sign}${s.index}</span></div>
        <div class="meter"><div class="mid"></div>${fill}</div>
        <div class="counts">${s.count} headlines · ${s.negEmoji} ${s.negLeaning} ${escapeHtml(s.negLabel)} · ${s.posEmoji} ${s.posLeaning} ${escapeHtml(s.posLabel)} · 😐 ${s.neutral}</div>
      </div>`;
    }).join("");

    const item = (x) => {
      const cls = moodClass(x.index);
      const words = [...x.negWords.map((w) => `${x.negEmoji} ${w}`), ...x.posWords.map((w) => `${x.posEmoji} ${w}`)].join(" · ");
      return `<a class="mood-item" href="${escapeAttr(x.link)}" target="_blank" rel="noopener">
        <span class="story-title">${escapeHtml(x.title)}</span>
        <span class="chip ${cls}">${x.index > 0 ? "+" : ""}${x.index}</span>
        <div class="story-meta"><span class="src">${escapeHtml(x.source)} · ${escapeHtml(x.spectrum)}</span></div>
        ${words ? `<div class="words">${escapeHtml(words)}</div>` : ""}
      </a>`;
    };

    body.innerHTML = `
      <div class="mood-sources">${srcHtml}</div>
      <div class="mood-cols">
        <div class="mood-col"><h3>Most negative</h3>
          ${data.negative.length ? data.negative.map(item).join("") : '<p class="muted">None today.</p>'}</div>
        <div class="mood-col"><h3>Most positive</h3>
          ${data.positive.length ? data.positive.map(item).join("") : '<p class="muted">None today.</p>'}</div>
      </div>`;
  } catch (e) {
    body.innerHTML = `<p class="error">Couldn't score headlines: ${escapeHtml(e.message)}</p>`;
  }
}

// ---- bookmarks section ----
function renderBookmarks() {
  const bm = getBookmarks();
  $("bm-count").textContent = bm.length ? `${bm.length}` : "";
  const list = $("bm-list");
  if (!bm.length) {
    list.innerHTML = `<p class="muted">Nothing saved yet — tap ☆ on any headline to keep it here.</p>`;
    return;
  }
  const date = (ts) => new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  list.innerHTML = bm.map((b) => `
    <div class="story-row">
      <a class="story" href="${escapeAttr(b.link)}" target="_blank" rel="noopener">
        <div class="story-title">${escapeHtml(b.title)}</div>
        <div class="story-meta"><span class="src">${escapeHtml(b.source)}</span>
          <span>saved ${date(b.savedAt)}</span></div>
      </a>
      <button class="bm-btn saved" data-link="${escapeAttr(b.link)}" title="Remove bookmark"
        aria-label="Remove bookmark" aria-pressed="true">★</button>
    </div>`).join("");
}

function setBmOpen(open) {
  $("bm-body").hidden = !open;
  $("bm-fold").setAttribute("aria-expanded", String(open));
  try { localStorage.setItem(BM_OPEN_KEY, open ? "1" : "0"); } catch {}
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/"/g, "&quot;");
}

// ---- wiring ----
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.newsRegion = tab.dataset.region;
    loadNews();
  });
});

// bookmark toggles in the news feed (event delegation — stories re-render)
$("news-body").addEventListener("click", (e) => {
  const btn = e.target.closest(".bm-btn");
  if (!btn) return;
  toggleBookmark({ title: btn.dataset.title, link: btn.dataset.link, source: btn.dataset.source });
  setBmBtn(btn, isBookmarked(btn.dataset.link));
});

// bookmark removal inside the bookmarks section
$("bm-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".bm-btn");
  if (!btn) return;
  toggleBookmark({ title: "", link: btn.dataset.link, source: "" });
});

// foldable bookmarks section
$("bm-fold").addEventListener("click", () => setBmOpen($("bm-body").hidden));
$("bm-fold").addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    setBmOpen($("bm-body").hidden);
  }
});

$("city-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("city-input").value.trim();
  if (!v) return;
  state.city = v;
  localStorage.setItem("briefing_city", v);
  $("city-input").value = "";
  $("city-input").placeholder = v;
  loadWeather();
});

$("locate-btn").addEventListener("click", () => {
  state.city = "";
  state.geo = null;
  state.geoTried = false;
  localStorage.removeItem("briefing_city");
  $("city-input").placeholder = "City…";
  loadWeather();
});

// Spin a refresh button while its loader runs.
async function spinWhile(btn, fn) {
  btn.classList.add("spinning");
  try { await fn(); } finally { btn.classList.remove("spinning"); }
}

async function refreshAll() {
  await Promise.all([loadWeather(), loadTasks(), loadNews(), loadMood()]);
}
$("refresh-all").addEventListener("click", (e) => spinWhile(e.currentTarget, refreshAll));
$("refresh-tasks").addEventListener("click", (e) => spinWhile(e.currentTarget, loadTasks));
$("refresh-mood").addEventListener("click", (e) => spinWhile(e.currentTarget, loadMood));

applyDaypart();
$("city-input").placeholder = state.city || "City…";
renderBookmarks();
setBmOpen(localStorage.getItem(BM_OPEN_KEY) === "1");
refreshAll();
setInterval(refreshAll, 15 * 60 * 1000);
setInterval(applyDaypart, 5 * 60 * 1000); // flip heading/theme when the daypart changes
