// Pixel pet — an 8-bit desktop pet widget for the Morning Briefing dashboard.
// Frontend-only: canvas sprite, stat simulation, localStorage persistence.
// No dependencies; honors prefers-reduced-motion.
(function () {
  "use strict";

  var PET_KEY = "briefing_pet";

  var MOODS = ["Ecstatic", "Happy", "Content", "Playful", "Curious", "Excited",
               "Surprised", "Sleepy", "Bored", "Hungry", "Grumpy", "Sad"];
  var MOOD_EMOJI = {
    Ecstatic: "🤩", Happy: "😊", Content: "😌", Playful: "😜",
    Curious: "🤔", Excited: "🤗", Surprised: "😲", Sleepy: "😴",
    Bored: "😐", Hungry: "🍽️", Grumpy: "😠", Sad: "😢"
  };

  var AFTERGLOW_MS = 90 * 1000;  // recent-interaction mood window
  var EVENT_MS = 60 * 1000;      // surprise/excitement window
  var ANIM_MS = 1200;            // feed / pet animation length

  // Per-hour decay applied over real elapsed time.
  var DECAY = { hunger: 5, happiness: 4, energy: 2.5 };
  var MAX_GAP_H = 72;            // don't decay beyond 3 days away

  function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }

  function defaultState() {
    return {
      hunger: 35, happiness: 70, energy: 80,
      lastFed: 0, lastPetted: 0, lastEvent: null, // lastEvent: {type, at}
      updatedAt: Date.now()
    };
  }

  function loadState() {
    var s = defaultState();
    try {
      var raw = (typeof localStorage !== "undefined") && localStorage.getItem(PET_KEY);
      if (raw) {
        var j = JSON.parse(raw);
        ["hunger", "happiness", "energy"].forEach(function (k) {
          if (typeof j[k] === "number" && isFinite(j[k])) s[k] = clamp(j[k]);
        });
        if (typeof j.lastFed === "number") s.lastFed = j.lastFed;
        if (typeof j.lastPetted === "number") s.lastPetted = j.lastPetted;
        if (j.lastEvent && typeof j.lastEvent.at === "number" &&
            (j.lastEvent.type === "surprised" || j.lastEvent.type === "excited")) {
          s.lastEvent = { type: j.lastEvent.type, at: j.lastEvent.at };
        }
        if (typeof j.updatedAt === "number") s.updatedAt = j.updatedAt;
      }
    } catch (e) { /* corrupted storage -> fresh pet */ }
    return s;
  }

  function saveState(s) {
    s.updatedAt = Date.now();
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(PET_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  function applyDecay(s, nowMs) {
    var elapsedH = Math.max(0, Math.min(MAX_GAP_H, (nowMs - s.updatedAt) / 3600000));
    s.hunger = clamp(s.hunger + DECAY.hunger * elapsedH);
    s.happiness = clamp(s.happiness - DECAY.happiness * elapsedH);
    s.energy = clamp(s.energy - DECAY.energy * elapsedH);
    s.updatedAt = nowMs;
    return s;
  }

  // Deterministic mood from stats + recent interaction. Every one of the
  // 12 moods is reachable; order matters (most specific first).
  function deriveMood(s, now) {
    now = now || Date.now();
    if (s.lastEvent && now - s.lastEvent.at < EVENT_MS) {
      if (s.lastEvent.type === "surprised") return "Surprised";
      if (s.lastEvent.type === "excited") return "Excited";
    }
    if (now - s.lastFed < AFTERGLOW_MS) return "Content";
    if (now - s.lastPetted < AFTERGLOW_MS) return s.happiness >= 60 ? "Ecstatic" : "Happy";
    if (s.energy <= 15) return "Sleepy";
    if (s.hunger >= 80) return "Hungry";
    if (s.happiness <= 12) return "Sad";
    if (s.happiness <= 30) return "Grumpy";
    if (s.hunger >= 60) return "Bored";
    if (s.happiness >= 85 && s.energy >= 45) return "Ecstatic";
    if (s.happiness >= 65) return "Happy";
    if (s.energy >= 75 && s.happiness >= 45) return "Playful";
    if (s.happiness >= 45) return "Content";
    if (s.hunger >= 25) return "Curious";
    return "Bored";
  }

  function feed(s, now) {
    now = now || Date.now();
    if (s.hunger < 12) {
      // Not hungry — the pet is charmed but baffled by the extra snack.
      s.lastEvent = { type: "surprised", at: now };
      s.happiness = clamp(s.happiness + 2);
      saveState(s);
      return { ok: false, note: "Not hungry… but surprised by the snack!" };
    }
    s.hunger = clamp(s.hunger - 30);
    s.happiness = clamp(s.happiness + 4);
    s.energy = clamp(s.energy + 6);
    s.lastFed = now;
    s.lastEvent = null;
    saveState(s);
    return { ok: true, note: "Nom nom nom…" };
  }

  function petPlay(s, now) {
    now = now || Date.now();
    if (s.energy < 15) {
      s.happiness = clamp(s.happiness + 3);
      saveState(s);
      return { ok: false, note: "Too sleepy to play — settles for a pat." };
    }
    s.happiness = clamp(s.happiness + 14);
    s.energy = clamp(s.energy - 6);
    s.hunger = clamp(s.hunger + 4);
    s.lastPetted = now;
    var excited = s.energy >= 75;
    s.lastEvent = excited ? { type: "excited", at: now } : null;
    saveState(s);
    return { ok: true, note: excited ? "Zoomies!!" : "Purr purr…" };
  }

  // ---- 8-bit sprite rendering (32x32 pixel grid, scaled x4) ----
  var GRID = 32, SCALE = 4;
  var C = {
    outline: "#3a2a18", body: "#f0a63c", dark: "#c97f24", belly: "#ffdca8",
    earIn: "#f49ac1", blush: "#f49ac1", mouth: "#7a2d1a", eye: "#2a1c10",
    white: "#ffffff", spark: "#fff3b0", tear: "#7cc4ff", crumb: "#8a5a2b",
    heart: "#f472a0", zzz: "#8a93a6"
  };

  function px(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x * SCALE, y * SCALE, w * SCALE, h * SCALE);
  }

  // Body silhouette rects: [x, y, w, h]
  var EARS = [[7, 6, 4, 3], [8, 4, 3, 2], [21, 6, 4, 3], [21, 4, 3, 2]];
  var BODY = [[11, 10, 10, 1], [9, 11, 14, 1], [8, 12, 16, 12], [9, 24, 14, 2]];
  var TAIL = [[24, 18, 3, 2], [26, 15, 2, 4]];
  var FEET = [[9, 26, 4, 2], [19, 26, 4, 2]];

  function drawBody(ctx) {
    // 1px dark outline: draw silhouette shapes slightly expanded underneath.
    EARS.concat(BODY, TAIL, FEET).forEach(function (r) {
      px(ctx, r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2, C.outline);
    });
    TAIL.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], C.dark); });
    px(ctx, 26, 12, 2, 3, C.body); // tail tip
    EARS.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], C.body); });
    px(ctx, 8, 5, 2, 2, C.earIn);
    px(ctx, 22, 5, 2, 2, C.earIn);
    BODY.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], C.body); });
    px(ctx, 12, 17, 8, 8, C.belly);          // belly patch
    FEET.forEach(function (r) { px(ctx, r[0], r[1], r[2], r[3], C.dark); });
    px(ctx, 9, 16, 2, 1, C.blush);           // blush
    px(ctx, 21, 16, 2, 1, C.blush);
  }

  function drawZ(ctx, x, y, s) {
    // pixel "Z", s = size unit
    px(ctx, x, y, 3 * s, s, C.zzz);
    px(ctx, x + 2 * s, y + s, s, s, C.zzz);
    px(ctx, x + s, y + 2 * s, s, s, C.zzz);
    px(ctx, x, y + 3 * s, 3 * s, s, C.zzz);
  }

  function drawFace(ctx, mood, blink, eating) {
    var E = C.eye, M = C.mouth;
    if (eating) {
      px(ctx, 10, 15, 3, 1, E); px(ctx, 19, 15, 3, 1, E); // happy scrunched eyes
      px(ctx, 13, 18, 6, 3, M);
      px(ctx, 15, 20, 2, 1, C.earIn); // tongue
      return;
    }
    switch (mood) {
      case "Ecstatic":
        px(ctx, 9, 14, 1, 1, E); px(ctx, 10, 13, 2, 1, E); px(ctx, 12, 14, 1, 1, E);
        px(ctx, 19, 14, 1, 1, E); px(ctx, 20, 13, 2, 1, E); px(ctx, 22, 14, 1, 1, E);
        px(ctx, 13, 18, 6, 3, M); px(ctx, 15, 20, 2, 1, C.earIn);
        break;
      case "Happy":
        if (blink) { px(ctx, 10, 15, 3, 1, E); px(ctx, 19, 15, 3, 1, E); }
        else { px(ctx, 10, 15, 2, 2, E); px(ctx, 20, 15, 2, 2, E); }
        px(ctx, 12, 18, 1, 1, E); px(ctx, 13, 19, 6, 1, E); px(ctx, 19, 18, 1, 1, E);
        break;
      case "Content":
        px(ctx, 10, 15, 3, 1, E); px(ctx, 19, 15, 3, 1, E);
        px(ctx, 14, 19, 4, 1, E);
        break;
      case "Playful":
        px(ctx, 10, 15, 3, 1, E); // wink
        if (blink) { px(ctx, 20, 15, 3, 1, E); } else { px(ctx, 20, 15, 2, 2, E); }
        px(ctx, 13, 19, 6, 1, E); px(ctx, 16, 20, 2, 2, C.earIn); // tongue out
        break;
      case "Curious":
        px(ctx, 9, 14, 4, 4, C.white); px(ctx, 19, 14, 4, 4, C.white);
        if (!blink) { px(ctx, 11, 15, 2, 2, E); px(ctx, 21, 15, 2, 2, E); }
        px(ctx, 15, 19, 2, 2, E);
        break;
      case "Excited":
        px(ctx, 10, 14, 3, 1, C.spark); px(ctx, 11, 13, 1, 3, C.spark);
        px(ctx, 20, 14, 3, 1, C.spark); px(ctx, 21, 13, 1, 3, C.spark);
        px(ctx, 14, 18, 4, 2, M);
        break;
      case "Surprised":
        px(ctx, 9, 13, 4, 4, C.white); px(ctx, 19, 13, 4, 4, C.white);
        px(ctx, 10, 14, 2, 2, E); px(ctx, 20, 14, 2, 2, E);
        px(ctx, 14, 18, 4, 3, M);
        break;
      case "Sleepy":
        px(ctx, 10, 16, 3, 1, E); px(ctx, 19, 16, 3, 1, E);
        px(ctx, 14, 20, 4, 1, E);
        drawZ(ctx, 25, 4, 1);
        break;
      case "Bored":
        px(ctx, 10, 15, 2, 1, E); px(ctx, 20, 15, 2, 1, E);
        px(ctx, 13, 20, 6, 1, E);
        break;
      case "Hungry":
        px(ctx, 9, 13, 3, 1, E); px(ctx, 20, 13, 3, 1, E); // low worried brows
        if (blink) { px(ctx, 10, 15, 3, 1, E); px(ctx, 19, 15, 3, 1, E); }
        else { px(ctx, 10, 15, 2, 2, E); px(ctx, 20, 15, 2, 2, E); }
        px(ctx, 14, 18, 4, 2, M);
        break;
      case "Grumpy":
        px(ctx, 9, 12, 2, 1, E); px(ctx, 11, 13, 2, 1, E);
        px(ctx, 21, 12, 2, 1, E); px(ctx, 19, 13, 2, 1, E);
        if (blink) { px(ctx, 11, 15, 3, 1, E); px(ctx, 18, 15, 3, 1, E); }
        else { px(ctx, 11, 15, 2, 2, E); px(ctx, 19, 15, 2, 2, E); }
        px(ctx, 12, 19, 1, 1, E); px(ctx, 13, 20, 6, 1, E); px(ctx, 19, 19, 1, 1, E);
        break;
      case "Sad":
        if (blink) { px(ctx, 10, 15, 3, 1, E); px(ctx, 19, 15, 3, 1, E); }
        else { px(ctx, 10, 15, 2, 2, E); px(ctx, 20, 15, 2, 2, E); }
        px(ctx, 8, 17, 1, 2, C.tear);
        px(ctx, 12, 19, 1, 1, E); px(ctx, 13, 20, 6, 1, E); px(ctx, 19, 19, 1, 1, E);
        break;
    }
  }

  function drawHeart(ctx, x, y) {
    // 5x4 pixel heart
    px(ctx, x, y, 2, 1, C.heart); px(ctx, x + 3, y, 2, 1, C.heart);
    px(ctx, x, y + 1, 5, 1, C.heart);
    px(ctx, x + 1, y + 2, 3, 1, C.heart);
    px(ctx, x + 2, y + 3, 1, 1, C.heart);
  }

  // ---- widget ----
  function init() {
    var canvas = document.getElementById("pet-canvas");
    if (!canvas) return;
    var ctx = canvas.getContext("2d");
    var moodEl = document.getElementById("pet-mood");
    var noteEl = document.getElementById("pet-note");
    var feedBtn = document.getElementById("pet-feed");
    var playBtn = document.getElementById("pet-play");
    var bars = {
      hunger: document.getElementById("pet-hunger"),
      happiness: document.getElementById("pet-happiness"),
      energy: document.getElementById("pet-energy")
    };
    var vals = {
      hunger: document.getElementById("pet-hunger-v"),
      happiness: document.getElementById("pet-happiness-v"),
      energy: document.getElementById("pet-energy-v")
    };

    var reduced = typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    var s = applyDecay(loadState(), Date.now());
    saveState(s);

    var anim = null;       // { type: "feed"|"play", start: ms }
    var blinkingUntil = 0;
    var nextBlink = Date.now() + 2500;
    var noteTimer = null;

    function renderChrome() {
      var mood = deriveMood(s);
      if (moodEl) moodEl.textContent = MOOD_EMOJI[mood] + " " + mood;
      canvas.setAttribute("aria-label", "Pixel pet, feeling " + mood.toLowerCase());
      [["hunger"], ["happiness"], ["energy"]].forEach(function (kv) {
        var k = kv[0];
        if (bars[k]) {
          bars[k].style.width = s[k] + "%";
          bars[k].classList.toggle("bad", (k === "hunger" && s[k] >= 70) ||
                                          (k !== "hunger" && s[k] <= 25));
        }
        if (vals[k]) vals[k].textContent = s[k];
      });
    }

    function drawFrame(t) {
      var mood = deriveMood(s);
      var eating = !!(anim && anim.type === "feed" && t - anim.start < ANIM_MS);
      var playing = !!(anim && anim.type === "play" && t - anim.start < ANIM_MS);
      var blinking = !reduced && !eating && t < blinkingUntil;
      var bounce = (!reduced && !eating && !playing) ? (Math.floor(t / 500) % 2) : 0;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(0, bounce * SCALE);
      drawBody(ctx);
      drawFace(ctx, mood, blinking, eating);

      if (!reduced && eating) {
        var p = Math.min(1, (t - anim.start) / ANIM_MS);
        for (var i = 0; i < 10; i++) {
          var cx = 8 + ((i * 37) % 17);
          var cy = -4 + p * 14 - ((i * 13) % 5);
          if (cy > -2) px(ctx, cx, Math.min(cy, 8), 1, 1, C.crumb);
        }
      }
      if (!reduced && playing) {
        var q = Math.min(1, (t - anim.start) / ANIM_MS);
        for (var j = 0; j < 6; j++) {
          var hx = 6 + ((j * 53) % 21) + Math.sin(q * 6 + j) * 1.5;
          var hy = 26 - q * 26 - ((j * 7) % 4);
          drawHeart(ctx, Math.round(hx), Math.round(hy));
        }
      }
      ctx.restore();
    }

    function setNote(text) {
      if (!noteEl) return;
      noteEl.textContent = text;
      if (noteTimer) clearTimeout(noteTimer);
      noteTimer = setTimeout(function () { noteEl.textContent = ""; }, 2600);
    }

    function interact(kind) {
      if (anim) return;
      var now = Date.now();
      var res = kind === "feed" ? feed(s, now) : petPlay(s, now);
      setNote(res.note);
      renderChrome();
      if (reduced) { drawFrame(now); return; }
      anim = { type: kind, start: now };
      if (feedBtn) feedBtn.disabled = true;
      if (playBtn) playBtn.disabled = true;
      setTimeout(function () {
        anim = null;
        if (feedBtn) feedBtn.disabled = false;
        if (playBtn) playBtn.disabled = false;
        renderChrome();
      }, ANIM_MS);
    }

    if (feedBtn) feedBtn.addEventListener("click", function () { interact("feed"); });
    if (playBtn) playBtn.addEventListener("click", function () { interact("play"); });

    renderChrome();
    if (reduced) {
      drawFrame(Date.now());
      return;
    }
    (function loop(t) {
      var now = typeof t === "number" ? t : Date.now();
      if (now > nextBlink) { blinkingUntil = now + 150; nextBlink = now + 2500 + Math.random() * 3500; }
      drawFrame(now);
      requestAnimationFrame(loop);
    })();
    // Slow tick: decay + mood refresh so afterglows expire.
    setInterval(function () {
      applyDecay(s, Date.now());
      saveState(s);
      renderChrome();
    }, 60 * 1000);
  }

  // Test hook: pure logic exported for node-based checks.
  var api = {
    MOODS: MOODS, MOOD_EMOJI: MOOD_EMOJI, PET_KEY: PET_KEY,
    clamp: clamp, defaultState: defaultState, loadState: loadState,
    saveState: saveState, applyDecay: applyDecay,
    deriveMood: deriveMood, feed: feed, petPlay: petPlay
  };
  var root = typeof window !== "undefined" ? window : globalThis;
  root.PixelPet = api;

  if (typeof document !== "undefined" && document.getElementById("pet-canvas")) {
    init();
  }
})();
