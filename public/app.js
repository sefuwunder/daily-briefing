// Morning Briefing frontend
const $ = (id) => document.getElementById(id);

const state = {
  city: localStorage.getItem("briefing_city") || "",
  newsRegion: "caricom",
  geo: null,       // { lat, lon, name } from IP geolocation
  geoTried: false, // only hit the IP lookup once per page load
};

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
      <div class="wx-days">${days}</div>`;
  } catch (e) {
    body.innerHTML = `<p class="error">Couldn't load weather: ${escapeHtml(e.message)}</p>`;
  }
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
    const storyHtml = (s) => `
      <a class="story" href="${escapeAttr(s.link)}" target="_blank" rel="noopener">
        <div class="story-title">${escapeHtml(s.title)}</div>
        <div class="story-meta"><span class="src">${escapeHtml(s.source)}</span>
          <span>${timeAgo(s.pubDate)}</span></div>
      </a>`;
    const artsHtml = (data.arts && data.arts.length)
      ? `<h3 class="arts-head">🎨 Underground arts &amp; culture</h3>` +
        data.arts.map(storyHtml).join("")
      : "";
    body.innerHTML = data.items.map(storyHtml).join("") + artsHtml;
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

async function refreshAll() {
  await Promise.all([loadWeather(), loadTasks(), loadNews(), loadMood()]);
}
$("refresh-all").addEventListener("click", refreshAll);
$("refresh-tasks").addEventListener("click", loadTasks);
$("refresh-mood").addEventListener("click", loadMood);

applyDaypart();
$("city-input").placeholder = state.city || "City…";
refreshAll();
setInterval(refreshAll, 15 * 60 * 1000);
setInterval(applyDaypart, 5 * 60 * 1000); // flip heading/theme when the daypart changes
