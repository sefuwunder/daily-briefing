// Morning Briefing frontend
const $ = (id) => document.getElementById(id);

const state = {
  city: localStorage.getItem("briefing_city") || "New York",
  newsRegion: "caricom",
};

// ---- header ----
function renderDateline() {
  const now = new Date();
  const date = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const h = now.getHours();
  const greet = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("dateline").textContent = `${greet} — ${date}`;
}

// ---- weather ----
async function loadWeather() {
  const body = $("weather-body");
  try {
    const r = await fetch(`/api/weather?city=${encodeURIComponent(state.city)}`);
    const w = await r.json();
    if (!r.ok) throw new Error(w.error || "weather failed");
    const c = w.current;
    const days = w.daily.map((d) => {
      const label = new Date(d.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
      return `<div class="wx-day"><div class="d">${label}</div><div class="i">${d.icon}</div>
        <div class="t">${d.high_c}° <span>${d.low_c}°</span></div></div>`;
    }).join("");
    body.innerHTML = `
      <div class="wx-now">
        <div class="wx-icon">${c.icon}</div>
        <div>
          <div class="wx-temp">${c.temp_c}°<small>C</small></div>
          <div class="wx-meta"><strong>${w.place}</strong><br>
          ${c.description} · feels like ${c.feels_c}°<br>
          💧 ${c.humidity}% · 💨 ${c.wind_kph} km/h</div>
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
    if (!data.items.length) {
      body.innerHTML = `<p class="muted">No headlines right now.</p>`;
      return;
    }
    body.innerHTML = data.items.map((s) => `
      <a class="story" href="${escapeAttr(s.link)}" target="_blank" rel="noopener">
        <div class="story-title">${escapeHtml(s.title)}</div>
        <div class="story-meta"><span class="src">${escapeHtml(s.source)}</span>
          <span>${timeAgo(s.pubDate)}</span></div>
      </a>`).join("");
    $("updated").textContent =
      `News updated ${new Date(data.updated).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  } catch (e) {
    body.innerHTML = `<p class="error">Couldn't load headlines: ${escapeHtml(e.message)}</p>`;
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

async function refreshAll() {
  await Promise.all([loadWeather(), loadTasks(), loadNews()]);
}
$("refresh-all").addEventListener("click", refreshAll);
$("refresh-tasks").addEventListener("click", loadTasks);

renderDateline();
$("city-input").placeholder = state.city;
refreshAll();
setInterval(refreshAll, 15 * 60 * 1000);
