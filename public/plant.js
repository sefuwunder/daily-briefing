// GrowPlant — a 3D plant simulator widget for the Morning Briefing dashboard.
// Frontend-only: hand-rolled minimal WebGL (no three.js), semi-realtime growth
// simulation, localStorage persistence. Honors prefers-reduced-motion.
(function () {
"use strict";

var PLANT_KEY = "briefing_plant";

/* Growth model — all rates documented here:
 * WATER: a full tank (100) drains in ~18h (WATER_DECAY_PER_H). The plant
 *   only grows while water > 20 (WATERED_ABOVE); below that growth pauses.
 * SUN: daylight(h) is a sine hump over local 06:00–20:00, peaking at 13:00.
 *   sunFactor = 0.15 + 0.85 * daylight — plants rest at night, never fully stop.
 *   The sun badge and the WebGL light follow local time: warm low sun at
 *   golden hour, neutral white at midday, dim blue moonlight at night.
 * TEMP: tempAt = 22 + 6*sin(2π(h-9)/24) + seeded drift(±1.2°C) →
 *   ~16°C just before dawn, ~28°C mid-afternoon. tempFactor = 1.0 inside the
 *   18–28°C comfort band, tapering to 0.3 at 10°C / 36°C, 0.2 beyond.
 * COMBINED: growth += GROWTH_PER_H × sunFactor × tempFactor per watered hour,
 *   integrated in 15-minute steps across the elapsed gap (capped at 72h).
 * BASE RATE: GROWTH_PER_H = 100/120 → seed to bloom in 120 watered hours at
 *   factor 1.0 (ideal: warm bright days, always watered). A typical day
 *   averages ~0.45 combined (nights + cool mornings drag it down), so with
 *   attentive twice-daily watering expect bloom in ~11 days. Neglect pauses
 *   growth; it never shrinks. */
var GROWTH_PER_H = 100 / 120;
var WATER_DECAY_PER_H = 100 / 18;
var WATERED_ABOVE = 20;
var MAX_GAP_H = 72;
var WATER_ANIM_MS = 1400;
var STEP_H = 0.25; // catch-up integration step
var STEM_COUNT = 5;

var STAGES = [
  { at: 0,  name: "Seed",    emoji: "🌰" },
  { at: 8,  name: "Sprout",  emoji: "🌱" },
  { at: 20, name: "Stem",    emoji: "🌿" },
  { at: 40, name: "Leafy",   emoji: "🪴" },
  { at: 65, name: "Budding",  emoji: "🌷" },
  { at: 85, name: "Bloom",   emoji: "🌸" }
];

function clamp(v) { return Math.max(0, Math.min(100, Math.round(v))); }
function clampF(v) { return Math.max(0, Math.min(100, v)); } // no rounding: keeps fractional growth/water across ticks
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function defaultState() {
  return { growth: 0, water: 60, updatedAt: Date.now(),
           seed: Math.floor(Math.random() * 1e9) };
}

function loadState() {
  var s = defaultState();
  try {
    var raw = (typeof localStorage !== "undefined") && localStorage.getItem(PLANT_KEY);
    if (raw) {
      var j = JSON.parse(raw);
      if (typeof j.growth === "number" && isFinite(j.growth)) s.growth = clampF(j.growth);
      if (typeof j.water === "number" && isFinite(j.water)) s.water = clampF(j.water);
      if (typeof j.updatedAt === "number") s.updatedAt = j.updatedAt;
      if (typeof j.seed === "number" && isFinite(j.seed)) s.seed = Math.floor(Math.abs(j.seed));
    }
  } catch (e) { /* corrupted storage -> fresh seed */ }
  return s;
}

function saveState(s) {
  s.updatedAt = Date.now();
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(PLANT_KEY, JSON.stringify(s));
  } catch (e) {}
}

// Deterministic catch-up: water drains over the whole gap; growth advances
// only during watered hours, scaled by the sun and temperature at each step.
function simulate(s, nowMs) {
  var elapsedH = Math.max(0, Math.min(MAX_GAP_H, (nowMs - s.updatedAt) / 3600000));
  var t = 0;
  while (t < elapsedH - 1e-9) {
    var dt = Math.min(STEP_H, elapsedH - t);
    var at = s.updatedAt + t * 3600000;
    if (s.water > WATERED_ABOVE) {
      var h = hourOfDay(at);
      s.growth += GROWTH_PER_H * sunFactor(h) * tempFactor(tempAt(at, s.seed)) * dt;
    }
    s.water -= WATER_DECAY_PER_H * dt;
    t += dt;
  }
  s.growth = clampF(s.growth);
  s.water = clampF(s.water);
  s.updatedAt = nowMs;
  return s;
}

// ---- ambient conditions: sun + temperature, from local time ----

function hourOfDay(ms) {
  var d = new Date(ms);
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

function dayOfYear(d) {
  var start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

// 0 at night, sine hump peaking at 13:00 across 06:00–20:00.
function daylight(h) {
  if (h < 6 || h > 20) return 0;
  return Math.sin(Math.PI * (h - 6) / 14);
}

function sunFactor(h) {
  return 0.15 + 0.85 * daylight(h);
}

function sunBadge(h) {
  if (h >= 5 && h < 8)  return { icon: "🌅", label: "Morning" };
  if (h >= 8 && h < 16) return { icon: "☀️", label: "Midday" };
  if (h >= 16 && h < 20) return { icon: "🌇", label: "Evening" };
  return { icon: "🌙", label: "Night" };
}

// ~16°C just before dawn, ~28°C mid-afternoon, plus slow seeded drift.
function tempAt(ms, seed) {
  var d = new Date(ms);
  var h = hourOfDay(ms);
  var drift = 1.2 * Math.sin(seed * 0.001 + dayOfYear(d) * 0.7);
  return 22 + 6 * Math.sin(2 * Math.PI * (h - 9) / 24) + drift;
}

// 1.0 in the 18–28°C comfort band, tapering to 0.3 at 10/36°C, 0.2 beyond.
function tempFactor(t) {
  if (t >= 18 && t <= 28) return 1;
  if (t > 10 && t < 18) return 0.3 + 0.7 * (t - 10) / 8;
  if (t > 28 && t < 36) return 1 - 0.7 * (t - 28) / 8;
  return 0.2;
}

function norm3(v) {
  var l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// Lighting for the WebGL scene at local hour h:
// {dir, col (rgb × intensity), amb}. Warm low sun at golden hour, neutral at
// midday, dim blue moonlight at night.
function lightFor(h) {
  var dl = daylight(h);
  if (dl <= 0) {
    return { dir: norm3([0.3, 0.8, 0.5]), col: [0.10, 0.14, 0.28], amb: 0.16 };
  }
  var az = Math.PI * (h - 6) / 14; // east → west
  var el = dl * 1.1;               // up to ~63°
  var ce = Math.cos(el);
  var warm = 1 - Math.min(1, dl * 1.6); // 1 at horizon → 0 overhead
  var inten = 0.35 + 0.65 * dl;
  return {
    dir: norm3([Math.cos(az) * ce, Math.sin(el), Math.sin(az) * ce * 0.6 + 0.35]),
    col: [1.0 * inten, (0.98 - 0.36 * warm) * inten, (0.94 - 0.56 * warm) * inten],
    amb: 0.45
  };
}

// ---- multi-stem cluster: stable per-stem variation from the persisted seed ----
function makeStems(seed) {
  var stems = [];
  for (var i = 0; i < STEM_COUNT; i++) {
    var r1 = rnd(seed * 0.913 + i * 17.3 + 1);
    var r2 = rnd(seed * 1.710 + i * 31.7 + 2);
    var r3 = rnd(seed * 2.370 + i * 57.1 + 3);
    var r4 = rnd(seed * 3.190 + i * 91.7 + 4);
    var r5 = rnd(seed * 4.730 + i * 13.9 + 5);
    var ang = r1 * Math.PI * 2;
    var rad = i === 0 ? r2 * 0.15 : 0.12 + r2 * 0.33; // first stem near center
    stems.push({
      bx: Math.cos(ang) * rad,
      bz: Math.sin(ang) * rad,
      heightF: 0.75 + r3 * 0.3,  // 0.75..1.05
      leanAng: r4 * 0.13,        // 0..0.13 rad
      leanYaw: r5 * Math.PI * 2,
      leafYaw: r2 * Math.PI * 2,
      bloomDelay: r4 * 10        // 0..10 growth points: shorter stems bloom later
    });
  }
  return stems;
}

function stageFor(g) {
  var st = STAGES[0];
  for (var i = 0; i < STAGES.length; i++) if (g >= STAGES[i].at) st = STAGES[i];
  return st;
}

// Water button action (pure state change; the caller handles animation).
function waterAction(s) {
  if (s.water >= 95) {
    return { alreadyFull: true, note: "Already glistening — save some for later! 💧" };
  }
  s.water = 100;
  saveState(s);
  return { alreadyFull: false, note: "Glug glug glug…" };
}

// ---- tiny mat4 lib (column-major, WebGL convention) ----
function m4mul(a, b) {
  var o = new Array(16);
  for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) {
    o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] +
                   a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return o;
}
function m4persp(fovDeg, aspect, near, far) {
  var f = 1 / Math.tan(fovDeg * Math.PI / 360), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0,
          0, f, 0, 0,
          0, 0, (far + near) * nf, -1,
          0, 0, 2 * far * near * nf, 0];
}
function m4lookAt(e, c, up) {
  var zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
  var l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
  var xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
  l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
  var yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
  return [xx, yx, zx, 0,
          xy, yy, zy, 0,
          xz, yz, zz, 0,
          -(xx * e[0] + xy * e[1] + xz * e[2]),
          -(yx * e[0] + yy * e[1] + yz * e[2]),
          -(zx * e[0] + zy * e[1] + zz * e[2]), 1];
}
function m4rotY(a) {
  var c = Math.cos(a), s = Math.sin(a);
  return [c, 0, -s, 0,
          0, 1, 0, 0,
          s, 0, c, 0,
          0, 0, 0, 1];
}
// row-major 3x3 helpers for part orientation
function m3mul(a, b) {
  var o = new Array(9);
  for (var r = 0; r < 3; r++) for (var c = 0; c < 3; c++) {
    o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  }
  return o;
}
function m3ry(a) {
  var c = Math.cos(a), s = Math.sin(a);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
function m3rz(a) {
  var c = Math.cos(a), s = Math.sin(a);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function hexRGB(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ---- geometry: mesh = {p:[], n:[], c:[]} flat triangle soup ----
// addBoxR: axis box of size (w,h,d) centered at (cx,cy,cz), rotated by
// row-major 3x3 R, painted `color` ("#rrggbb").
function addBoxR(m, cx, cy, cz, w, h, d, R, color) {
  var hx = w / 2, hy = h / 2, hz = d / 2;
  var L = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
           [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
  var W = L.map(function (v) {
    return [cx + R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
            cy + R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
            cz + R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  });
  // [tri indices, local face normal]; CCW outward, no culling needed anyway
  var F = [
    [[4, 5, 6], [4, 6, 7], [0, 0, 1]],
    [[1, 0, 3], [1, 3, 2], [0, 0, -1]],
    [[5, 1, 2], [5, 2, 6], [1, 0, 0]],
    [[0, 4, 7], [0, 7, 3], [-1, 0, 0]],
    [[3, 7, 6], [3, 6, 2], [0, 1, 0]],
    [[0, 1, 5], [0, 5, 4], [0, -1, 0]]
  ];
  var col = hexRGB(color);
  F.forEach(function (f) {
    var nl = f[2];
    var nw = [R[0] * nl[0] + R[1] * nl[1] + R[2] * nl[2],
              R[3] * nl[0] + R[4] * nl[1] + R[5] * nl[2],
              R[6] * nl[0] + R[7] * nl[1] + R[8] * nl[2]];
    f[0].concat(f[1]).forEach(function (vi) {
      var v = W[vi];
      m.p.push(v[0], v[1], v[2]);
      m.n.push(nw[0], nw[1], nw[2]);
      m.c.push(col[0], col[1], col[2]);
    });
  });
}

var RID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

var C = {
  pot: "#b5543f", rim: "#8f3f2e", soil: "#4a3423", mound: "#5a4230",
  stem: "#3e8e41", leafYoung: "#6fbf73", leaf: "#46a34b",
  bud: "#2f7a33", petal: "#f2a0c0", center: "#ffd23f", drop: "#5ec8ff"
};

// Leaf pivoting at (px,py,pz), extending outward at yaw with pitch above horizontal.
function addLeaf(m, px, py, pz, yaw, pitch, len, color) {
  var R = m3mul(m3ry(yaw), m3rz(pitch));
  var cx = px + R[0] * len * 0.35, cy = py + R[3] * len * 0.35, cz = pz + R[6] * len * 0.35;
  addBoxR(m, cx, cy, cz, len, 0.06, 0.16 + len * 0.22, R, color);
}

var LEAF_PAIRS = [ // [growth threshold, stem fraction, yaw] — alternating sides
  [20, 0.32, 0],
  [32, 0.50, Math.PI],
  [44, 0.66, -Math.PI / 2],
  [56, 0.80, Math.PI / 2]
];

function buildScene(growth, seed) {
  var m = { p: [], n: [], c: [] };
  // terracotta pot + rim + soil
  addBoxR(m, 0, -0.85, 0, 1.35, 0.6, 1.35, RID, C.pot);
  addBoxR(m, 0, -0.45, 0, 1.75, 0.55, 1.75, RID, C.pot);
  addBoxR(m, 0, -0.14, 0, 1.95, 0.18, 1.95, RID, C.rim);
  addBoxR(m, 0, -0.05, 0, 1.68, 0.14, 1.68, RID, C.soil);

  var stems = makeStems(seed);
  var si, i, k;

  if (growth < 8) {
    for (si = 0; si < stems.length; si++) { // seeds in the soil
      addBoxR(m, stems[si].bx, 0.04, stems[si].bz, 0.3, 0.14, 0.3, RID, C.mound);
    }
    return m;
  }

  for (si = 0; si < stems.length; si++) {
    var st = stems[si];
    var gi = clamp(growth - st.bloomDelay); // shorter stems express growth later
    var R = m3mul(m3ry(st.leanYaw), m3rz(st.leanAng));
    var bx = st.bx, bz = st.bz;
    var atY = function (y) { // point y up the (possibly leaning) stem, world space
      return [bx + R[1] * y, R[4] * y, bz + R[7] * y];
    };

    var stemT = clamp01((gi - 8) / 57);
    var stemH = (0.12 + 2.2 * stemT) * st.heightF;
    var p0 = atY(0), p1 = atY(stemH);
    addBoxR(m, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2,
            0.09, stemH, 0.09, R, C.stem);

    var maxPairs = st.heightF > 0.95 ? LEAF_PAIRS.length : LEAF_PAIRS.length - 1;
    if (gi < 20) {
      // cotyledons: two tiny leaves at the tip
      var tp = atY(stemH * 0.92);
      addLeaf(m, tp[0], tp[1], tp[2], st.leafYaw, -0.35, 0.28, C.leafYoung);
      addLeaf(m, tp[0], tp[1], tp[2], st.leafYaw + Math.PI, -0.35, 0.28, C.leafYoung);
    } else {
      for (i = 0; i < maxPairs; i++) {
        var at = LEAF_PAIRS[i][0], frac = LEAF_PAIRS[i][1];
        var yaw = LEAF_PAIRS[i][2] + st.leafYaw;
        var pm = clamp01((gi - at) / 22);
        if (pm <= 0) continue;
        var ap = atY(Math.max(0.22, stemH * frac));
        var len = (0.15 + 0.55 * pm) * st.heightF;
        var pitch = (-50 + 65 * pm) * Math.PI / 180; // droop -> lift as it matures
        addLeaf(m, ap[0], ap[1], ap[2], yaw, pitch, len, pm < 0.5 ? C.leafYoung : C.leaf);
      }
    }

    var tip = atY(stemH);
    if (gi >= 65 && gi < 85) {
      var bs = 0.1 + 0.12 * clamp01((gi - 65) / 20);
      addBoxR(m, tip[0], tip[1] + bs * 0.7, tip[2], bs * 2, bs * 2.2, bs * 2, RID, C.bud);
    }
    if (gi >= 85) {
      var f = clamp01((gi - 85) / 15);
      var fy = tip[1] + 0.12 * f;
      addBoxR(m, tip[0], fy, tip[2], 0.16 * f + 0.03, 0.14 * f + 0.03, 0.16 * f + 0.03,
              RID, C.center);
      for (k = 0; k < 5; k++) {
        var pyaw = k * Math.PI * 2 / 5 + 0.3 + st.leafYaw;
        var pr = (0.3 * f + 0.03) * 0.9;
        var pR = m3mul(m3ry(pyaw), m3rz(-0.5));
        addBoxR(m, tip[0] + Math.cos(pyaw) * pr, fy + 0.06, tip[2] - Math.sin(pyaw) * pr,
                0.34 * f + 0.04, 0.05, 0.2 * f + 0.03, pR, C.petal);
      }
    }
  }
  return m;
}

// Watering droplets. i = droplet index, el = seconds since pour started.
// bounce=true -> droplets bounce off the soil (already-full charm).
// Returns {x,y,z} or null when the droplet is inactive.
function dropletPos(i, el, bounce) {
  var d = i * 0.055, dur = bounce ? 0.9 : 0.55;
  var lt = (el - d) / dur;
  if (lt < 0 || lt > 1) return null;
  var x = (rnd(i * 2 + 1) - 0.5) * 1.15, z = (rnd(i * 2 + 2) - 0.5) * 1.15, y;
  if (!bounce) {
    y = 3.3 - 3.25 * lt * lt;
  } else if (lt < 0.5) {
    var p1 = lt / 0.5;
    y = 3.3 - 3.25 * p1 * p1;
  } else {
    var p2 = (lt - 0.5) / 0.5;
    y = 0.05 + 0.55 * Math.sin(Math.PI * p2);
  }
  return { x: x, y: y, z: z };
}

// ---- WebGL ----
var VSH = "precision mediump float;\n" +
  "attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol;\n" +
  "uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;\n" +
  "uniform vec3 uLight; uniform vec3 uLightCol; uniform float uAmb;\n" +
  "varying vec3 vCol;\n" +
  "void main(){\n" +
  "  vec4 wp = uModel * vec4(aPos, 1.0);\n" +
  "  vec3 n = normalize(mat3(uModel) * aNor);\n" +
  "  float diff = max(dot(n, normalize(uLight)), 0.0);\n" +
  "  vCol = aCol * (uAmb + uLightCol * diff);\n" +
  "  gl_Position = uProj * uView * wp;\n" +
  "}";
var FSH = "precision mediump float;\n" +
  "varying vec3 vCol;\n" +
  "void main(){ gl_FragColor = vec4(vCol, 1.0); }";

function compileShader(gl, type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader");
  return sh;
}

function initGL(canvas) {
  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: true, antialias: true }) ||
         canvas.getContext("experimental-webgl");
  } catch (e) { gl = null; }
  if (!gl) return null;
  var prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, VSH));
    gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, FSH));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  } catch (e) { return null; }
  gl.useProgram(prog);
  function attr(name) {
    var loc = gl.getAttribLocation(prog, name);
    var buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    return buf;
  }
  var G = {
    gl: gl,
    posBuf: attr("aPos"), norBuf: attr("aNor"), colBuf: attr("aCol"),
    uProj: gl.getUniformLocation(prog, "uProj"),
    uView: gl.getUniformLocation(prog, "uView"),
    uModel: gl.getUniformLocation(prog, "uModel"),
    uLight: gl.getUniformLocation(prog, "uLight"),
    uLightCol: gl.getUniformLocation(prog, "uLightCol"),
    uAmb: gl.getUniformLocation(prog, "uAmb")
  };
  gl.enable(gl.DEPTH_TEST);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  var aspect = canvas.width / canvas.height;
  gl.uniformMatrix4fv(G.uProj, false, m4persp(44, aspect, 0.1, 60));
  gl.uniformMatrix4fv(G.uView, false,
    m4lookAt([3.3, 2.3, 4.3], [0, 0.65, 0], [0, 1, 0]));
  setLighting(G, hourOfDay(Date.now()));
  return G;
}

// Push the sun/temperature-driven lighting for local hour h into the shader.
function setLighting(G, h) {
  var L = lightFor(h);
  G.gl.uniform3fv(G.uLight, L.dir);
  G.gl.uniform3fv(G.uLightCol, L.col);
  G.gl.uniform1f(G.uAmb, L.amb);
}

function uploadBuf(G, buf, arr) {
  var gl = G.gl;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.DYNAMIC_DRAW);
}

// Render one frame. growth 0..100, rotY radians, swayPhase radians (0 = still).
// drops: null or {t, w} with w = {bounce}.
function renderFrame(G, growth, seed, rotY, swayPhase, drops) {
  var gl = G.gl;
  var m = buildScene(growth, seed);
  var i, y;
  for (i = 0; i < m.p.length; i += 3) {
    y = m.p[i + 1];
    if (y > 0.02) {
      m.p[i] += Math.sin(swayPhase + y * 0.85 + m.p[i] * 0.6) * 0.04 * Math.min(1, y / 2.2);
    }
  }
  if (drops) {
    for (i = 0; i < 14; i++) {
      var dp = dropletPos(i, drops.t - drops.w.start, drops.w.bounce);
      if (dp) addBoxR(m, dp.x, dp.y, dp.z, 0.07, 0.11, 0.07, RID, C.drop);
    }
  }
  uploadBuf(G, G.posBuf, m.p);
  uploadBuf(G, G.norBuf, m.n);
  uploadBuf(G, G.colBuf, m.c);
  gl.uniformMatrix4fv(G.uModel, false, m4rotY(rotY));
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, m.p.length / 3);
}

// ---- widget ----
function init() {
  var canvas = document.getElementById("plant-canvas");
  if (!canvas) return;
  var wrap = document.getElementById("plant-wrap");
  var fallback = document.getElementById("plant-fallback");
  var stageEl = document.getElementById("plant-stage");
  var sunEl = document.getElementById("plant-sun");
  var tempEl = document.getElementById("plant-temp");
  var barEl = document.getElementById("plant-water-bar");
  var valEl = document.getElementById("plant-water-v");
  var btn = document.getElementById("plant-water");
  var noteEl = document.getElementById("plant-note");

  var reduced = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  var s = simulate(loadState(), Date.now());
  saveState(s);

  function renderChrome() {
    var st = stageFor(s.growth);
    if (stageEl) stageEl.textContent = st.emoji + " " + st.name + " · " + Math.round(s.growth) + "%";
    canvas.setAttribute("aria-label",
      "3D plant, " + st.name.toLowerCase() + ", " + Math.round(s.growth) + "% grown");
    if (barEl) {
      barEl.style.width = s.water + "%";
      barEl.classList.toggle("bad", s.water <= 25);
    }
    if (valEl) valEl.textContent = Math.round(s.water);
  }

  function renderEnv(nowMs) {
    var h = hourOfDay(nowMs);
    var sb = sunBadge(h);
    if (sunEl) sunEl.textContent = sb.icon + " " + sb.label;
    if (tempEl) tempEl.textContent = "🌡️ " + tempAt(nowMs, s.seed).toFixed(1) + "°C";
  }

  var G = initGL(canvas);
  if (!G) {
    if (wrap) wrap.style.display = "none";
    if (fallback) fallback.hidden = false;
    if (btn) btn.disabled = true;
    renderChrome();
    renderEnv(Date.now());
    return;
  }

  var watering = null; // {start (sec), bounce}
  var noteTimer = null;
  var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

  function nowSec() {
    return ((typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000) - t0;
  }

  function setNote(text) {
    if (!noteEl) return;
    noteEl.textContent = text;
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { noteEl.textContent = ""; }, 2600);
  }

  function doWater() {
    if (watering) return;
    var res = waterAction(s);
    setNote(res.note);
    renderChrome();
    if (reduced) { renderFrame(G, s.growth, s.seed, 0.6, 0, null); return; }
    watering = { start: nowSec(), bounce: res.alreadyFull };
    if (btn) btn.disabled = true;
  }

  if (btn) btn.addEventListener("click", doWater);

  renderChrome();
  renderEnv(Date.now());
  if (reduced) {
    setLighting(G, hourOfDay(Date.now()));
    renderFrame(G, s.growth, s.seed, 0.6, 0, null);
    return;
  }
  (function loop() {
    var t = nowSec();
    var drops = null;
    if (watering) {
      var el = t - watering.start;
      var dur = watering.bounce ? 0.9 : WATER_ANIM_MS / 1000;
      if (el > dur + 0.9) {
        watering = null;
        if (btn) btn.disabled = false;
      } else {
        drops = { t: t, w: watering };
      }
    }
    setLighting(G, hourOfDay(Date.now()));
    renderFrame(G, s.growth, s.seed, 0.6 + t * 0.12, t * 1.4, drops);
    requestAnimationFrame(loop);
  })();
  // Slow tick: growth + water catch-up so the widget stays truthful.
  setInterval(function () {
    var now = Date.now();
    simulate(s, now);
    saveState(s);
    renderChrome();
    renderEnv(now);
  }, 60 * 1000);
}

// Test hook: pure logic exported for node-based checks.
var api = {
  PLANT_KEY: PLANT_KEY,
  GROWTH_PER_H: GROWTH_PER_H, WATER_DECAY_PER_H: WATER_DECAY_PER_H,
  WATERED_ABOVE: WATERED_ABOVE, MAX_GAP_H: MAX_GAP_H, STEP_H: STEP_H,
  STEM_COUNT: STEM_COUNT,
  STAGES: STAGES, LEAF_PAIRS: LEAF_PAIRS,
  clamp: clamp, clampF: clampF, clamp01: clamp01, rnd: rnd,
  defaultState: defaultState, loadState: loadState, saveState: saveState,
  simulate: simulate, stageFor: stageFor, waterAction: waterAction,
  hourOfDay: hourOfDay, dayOfYear: dayOfYear, daylight: daylight,
  sunFactor: sunFactor, sunBadge: sunBadge,
  tempAt: tempAt, tempFactor: tempFactor, lightFor: lightFor, norm3: norm3,
  makeStems: makeStems,
  hexRGB: hexRGB, m4mul: m4mul, m4persp: m4persp, m4lookAt: m4lookAt, m4rotY: m4rotY,
  m3mul: m3mul, m3ry: m3ry, m3rz: m3rz,
  addBoxR: addBoxR, addLeaf: addLeaf, buildScene: buildScene,
  dropletPos: dropletPos, renderFrame: renderFrame, initGL: initGL,
  setLighting: setLighting
};
var root = typeof window !== "undefined" ? window : globalThis;
root.GrowPlant = api;

if (typeof document !== "undefined" && document.getElementById("plant-canvas")) {
  init();
}
})();
