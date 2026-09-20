// MeadowView — a 3D grass meadow simulator widget for the Morning Briefing.
// Frontend-only: hand-rolled minimal WebGL (no three.js). Ambient, no buttons:
// time-of-day follows local time and weather follows the weather widget's live
// Open-Meteo data (shared via window.__briefingWeather / "briefing:weather"
// event — the meadow never fetches). Honors prefers-reduced-motion.
(function () {
"use strict";

// ---- weather-code mapping (Open-Meteo WMO codes) ----
// kind: clear | cloudy | rain | snow | fog | storm ; intensity 0..1
function conditionFor(code) {
  if (code === 0) return { kind: "clear", intensity: 0 };
  if (code === 1) return { kind: "clear", intensity: 0.25 };
  if (code === 2) return { kind: "cloudy", intensity: 0.45 };
  if (code === 3) return { kind: "cloudy", intensity: 1 };
  if (code === 45 || code === 48) return { kind: "fog", intensity: 1 };
  if (code === 51 || code === 56) return { kind: "rain", intensity: 0.3 };
  if (code === 53 || code === 57) return { kind: "rain", intensity: 0.55 };
  if (code === 55) return { kind: "rain", intensity: 0.75 };
  if (code === 61 || code === 80) return { kind: "rain", intensity: 0.4 };
  if (code === 63 || code === 81) return { kind: "rain", intensity: 0.7 };
  if (code === 65 || code === 82) return { kind: "rain", intensity: 1 };
  if (code === 66 || code === 67) return { kind: "rain", intensity: 0.6 };
  if (code === 71 || code === 85 || code === 77) return { kind: "snow", intensity: 0.4 };
  if (code === 73) return { kind: "snow", intensity: 0.7 };
  if (code === 75 || code === 86) return { kind: "snow", intensity: 1 };
  if (code === 95) return { kind: "storm", intensity: 0.8 };
  if (code === 96 || code === 99) return { kind: "storm", intensity: 1 };
  return { kind: "clear", intensity: 0 }; // unknown -> calm
}

// ---- time of day ----
// srH/ssH: sunrise/sunset as decimal local hours (from the weather payload;
// falls back to 6/20 when unavailable).
function timePhase(h, srH, ssH) {
  if (!(srH >= 0 && ssH > srH)) { srH = 6; ssH = 20; }
  if (h < srH - 1 || h >= ssH + 1) return "night";
  if (h < srH + 1) return "dawn";
  if (h < ssH - 1) return "day";
  return "dusk";
}

// Sun direction for local hour h (unit-ish vec3, y up). Night -> moon path.
function sunDir(h, srH, ssH, night) {
  var a, b, t;
  if (!night) {
    t = Math.max(0, Math.min(1, (h - srH) / Math.max(0.5, ssH - srH)));
    a = Math.PI * t; // east -> west
    return norm3([-Math.cos(a), Math.sin(a) * 0.9 + 0.08, 0.35]);
  }
  var nightLen = 24 - (ssH - srH);
  t = (((h - ssH) % 24) + 24) % 24 / Math.max(0.5, nightLen);
  a = Math.PI * t;
  return norm3([-Math.cos(a), Math.sin(a) * 0.7 + 0.15, -0.3]);
}

function norm3(v) {
  var l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function hexRGB(hex) {
  var n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// Sky + light palette for a phase and condition.
// Returns {top, horizon, sunCol, sunI, moonI, amb, fogCol, fogDen, cloud,
//          groundTint, snowMix, lightCol} — all colors linear 0..1 rgb arrays.
function skyPalette(phase, cond) {
  var night = phase === "night";
  var top, horizon, sunCol, sunI, amb;
  if (night) {
    top = hexRGB("#050912"); horizon = hexRGB("#0e1830");
    sunCol = hexRGB("#9db8ff"); sunI = 0.35; amb = 0.22;
  } else if (phase === "dawn") {
    top = hexRGB("#3d5c9e"); horizon = hexRGB("#f2a45e");
    sunCol = hexRGB("#ffb36b"); sunI = 0.9; amb = 0.4;
  } else if (phase === "dusk") {
    top = hexRGB("#2c3a6e"); horizon = hexRGB("#e0703f");
    sunCol = hexRGB("#ff8f4d"); sunI = 0.85; amb = 0.38;
  } else {
    top = hexRGB("#2f7fd0"); horizon = hexRGB("#bfe0f5");
    sunCol = hexRGB("#fff4e0"); sunI = 1.15; amb = 0.5;
  }
  var gray = hexRGB("#8d99a6"), darkGray = hexRGB("#5a636e");
  var k = cond.kind, inten = cond.intensity;
  var cloud = 0, fogDen = night ? 0.016 : 0.011, snowMix = 0;
  var groundTint = [1, 1, 1];
  if (k === "cloudy") {
    cloud = 0.35 + 0.65 * inten;
    top = mixc(top, gray, 0.55 * inten); horizon = mixc(horizon, gray, 0.6 * inten);
    sunI *= 1 - 0.55 * inten; amb *= 1 - 0.2 * inten; fogDen = 0.02;
    groundTint = [0.9, 0.92, 0.9];
  } else if (k === "rain") {
    cloud = 0.9;
    top = mixc(top, darkGray, 0.75); horizon = mixc(horizon, darkGray, 0.8);
    sunI *= 0.35; amb = Math.max(0.25, amb * 0.8); fogDen = 0.032;
    groundTint = [0.62, 0.66, 0.62]; // wet, darker
  } else if (k === "storm") {
    cloud = 1;
    top = mixc(top, hexRGB("#2c313a"), 0.9); horizon = mixc(horizon, hexRGB("#3a4048"), 0.9);
    sunI *= 0.22; amb = 0.28; fogDen = 0.038;
    groundTint = [0.5, 0.54, 0.5];
  } else if (k === "snow") {
    cloud = 0.7;
    top = mixc(top, hexRGB("#aeb9c6"), 0.7); horizon = mixc(horizon, hexRGB("#d7dee6"), 0.75);
    sunI *= 0.55; amb = Math.max(0.4, amb); fogDen = 0.028;
    snowMix = 0.25 + 0.65 * inten;
    groundTint = [0.95, 0.96, 1.0];
  } else if (k === "fog") {
    cloud = 0.4;
    top = mixc(top, hexRGB("#b9c2cc"), 0.75); horizon = mixc(horizon, hexRGB("#cdd5dd"), 0.8);
    sunI *= 0.4; amb = Math.max(0.42, amb); fogDen = 0.085;
    groundTint = [0.88, 0.9, 0.9];
  } else if (k === "clear" && inten > 0) {
    cloud = 0.25 * inten;
    sunI *= 1 - 0.15 * inten;
  }
  return {
    top: top, horizon: horizon, sunCol: sunCol, sunI: sunI, amb: amb,
    fogCol: horizon, fogDen: fogDen, cloud: cloud,
    groundTint: groundTint, snowMix: snowMix
  };
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

// ---- geometry: mesh = {p:[], n:[], c:[], s:[]} triangle soup ----
// s: per-vertex sway info [phase, heightFrac] (0,0 = static).
function rnd(i) { var x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }

function groundY(x, z) {
  return 0.9 * Math.sin(x * 0.32) * Math.cos(z * 0.29) +
         0.45 * Math.sin(x * 0.83 + 1.7) * Math.sin(z * 0.77 + 0.6);
}

function buildGround() {
  var m = { p: [], n: [], c: [], s: [] };
  var N = 46, EXT = 15, i, j, ix, iz;
  var g1 = hexRGB("#3f7a34"), g2 = hexRGB("#5da244"), g3 = hexRGB("#2e5c28");
  for (i = 0; i <= N; i++) for (j = 0; j <= N; j++) {
    var x = -EXT + 2 * EXT * i / N, z = -EXT + 2 * EXT * j / N;
    var y = groundY(x, z);
    var v = rnd(i * 131.7 + j * 17.3);
    var low = Math.max(0, Math.min(1, (0.4 - y) / 1.6)); // darker in dips
    var col = mixc(mixc(g1, g2, v), g3, low * 0.7);
    m.p.push(x, y, z); m.n.push(0, 1, 0);
    m.c.push(col[0], col[1], col[2]); m.s.push(0, 0);
  }
  function idx(i, j) { return i * (N + 1) + j; }
  var quads = [];
  for (i = 0; i < N; i++) for (j = 0; j < N; j++) {
    quads.push([idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)]);
    quads.push([idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]);
  }
  var out = { p: [], n: [], c: [], s: [] };
  quads.forEach(function (q) {
    q.forEach(function (vi) {
      out.p.push(m.p[vi * 3], m.p[vi * 3 + 1], m.p[vi * 3 + 2]);
      out.n.push(0, 1, 0);
      out.c.push(m.c[vi * 3], m.c[vi * 3 + 1], m.c[vi * 3 + 2]);
      out.s.push(0, 0);
    });
  });
  return out;
}

// A single grass blade: one triangle, tip sways fully (heightFrac 1).
function bladeVerts(bx, bz, yaw, w, h, lean, phase, colBase, colTip) {
  var gy = groundY(bx, bz);
  var px = Math.cos(yaw), pz = Math.sin(yaw);
  var v = [
    [bx - px * w / 2, gy, bz - pz * w / 2, 0],
    [bx + px * w / 2, gy, bz + pz * w / 2, 0],
    [bx + lean * 0.5, gy + h, bz + lean * 0.35, 1]
  ];
  var cols = [colBase, colBase, colTip];
  return { v: v, cols: cols, phase: phase };
}

function buildGrass(count, seed) {
  var m = { p: [], n: [], c: [], s: [] };
  var g1 = hexRGB("#4c8f3c"), g2 = hexRGB("#79c25e"), g3 = hexRGB("#a8d97e");
  for (var i = 0; i < count; i++) {
    var r1 = rnd(seed + i * 3.1), r2 = rnd(seed + i * 7.7 + 1), r3 = rnd(seed + i * 13.3 + 2);
    var r4 = rnd(seed + i * 19.9 + 3), r5 = rnd(seed + i * 29.3 + 4);
    var bx = (r1 - 0.5) * 27, bz = (r2 - 0.5) * 27 - 1;
    var h = 0.55 + r3 * 0.65, w = 0.05 + r4 * 0.04;
    var shade = r5;
    var colBase = mixc(g1, g2, shade), colTip = mixc(g2, g3, shade);
    var b = bladeVerts(bx, bz, r4 * Math.PI * 2, w, h, (r3 - 0.5) * 0.5, r1 * Math.PI * 2, colBase, colTip);
    for (var k = 0; k < 3; k++) {
      m.p.push(b.v[k][0], b.v[k][1], b.v[k][2]);
      m.n.push(0, 1, 0);
      m.c.push(b.cols[k][0], b.cols[k][1], b.cols[k][2]);
      m.s.push(b.phase, b.v[k][3]);
    }
  }
  return m;
}

// Simple box helper (axis box, optional yaw), painted color.
function addBox(m, cx, cy, cz, w, h, d, yaw, color) {
  var c = Math.cos(yaw || 0), s = Math.sin(yaw || 0);
  var hx = w / 2, hy = h / 2, hz = d / 2;
  var L = [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, hy, -hz], [-hx, hy, -hz],
           [-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]];
  var W = L.map(function (v) {
    return [cx + c * v[0] + s * v[2], cy + v[1], cz - s * v[0] + c * v[2]];
  });
  var F = [
    [[4, 5, 6], [4, 6, 7], [0, 0, 1]], [[1, 0, 3], [1, 3, 2], [0, 0, -1]],
    [[5, 1, 2], [5, 2, 6], [1, 0, 0]], [[0, 4, 7], [0, 7, 3], [-1, 0, 0]],
    [[3, 7, 6], [3, 6, 2], [0, 1, 0]], [[0, 1, 5], [0, 5, 4], [0, -1, 0]]
  ];
  var col = hexRGB(color), R = [c, 0, s, 0, 1, 0, -s, 0, c];
  F.forEach(function (f) {
    var nl = f[2];
    var nw = [R[0] * nl[0] + R[2] * nl[2], nl[1], R[6] * nl[0] + R[8] * nl[2]];
    f[0].concat(f[1]).forEach(function (vi) {
      m.p.push(W[vi][0], W[vi][1], W[vi][2]);
      m.n.push(nw[0], nw[1], nw[2]);
      m.c.push(col[0], col[1], col[2]);
      m.s.push(0, 0);
    });
  });
}

var FLOWER_COLS = ["#ffffff", "#f2a0c0", "#ffd23f", "#b79df2", "#ff8f6b"];

function buildFlowers(count, seed) {
  var m = { p: [], n: [], c: [], s: [] };
  for (var i = 0; i < count; i++) {
    var r1 = rnd(seed + 101 + i * 5.3), r2 = rnd(seed + 202 + i * 11.7);
    var r3 = rnd(seed + 303 + i * 17.1);
    var bx = (r1 - 0.5) * 24, bz = (r2 - 0.5) * 22 - 1;
    var gy = groundY(bx, bz), sh = 0.35 + r3 * 0.25;
    var col = FLOWER_COLS[Math.floor(r1 * FLOWER_COLS.length) % FLOWER_COLS.length];
    addBox(m, bx, gy + sh / 2, bz, 0.035, sh, 0.035, 0, "#3e8e41");
    var hy = gy + sh;
    addBox(m, bx, hy, bz, 0.16, 0.1, 0.16, r2 * 3, col);
    addBox(m, bx, hy + 0.09, bz, 0.09, 0.07, 0.09, 0, "#ffdf5e");
  }
  return m;
}

function buildRocks(count, seed) {
  var m = { p: [], n: [], c: [], s: [] };
  for (var i = 0; i < count; i++) {
    var r1 = rnd(seed + 401 + i * 7.9), r2 = rnd(seed + 502 + i * 13.1);
    var bx = (r1 - 0.5) * 26, bz = (r2 - 0.5) * 24 - 1;
    var gy = groundY(bx, bz), s = 0.25 + r1 * 0.45;
    addBox(m, bx, gy + s * 0.18, bz, s, s * 0.55, s * 0.8, r2 * 3.1, "#8a8f96");
  }
  return m;
}

function mergeMeshes(list) {
  var m = { p: [], n: [], c: [], s: [] };
  list.forEach(function (g) {
    m.p = m.p.concat(g.p); m.n = m.n.concat(g.n);
    m.c = m.c.concat(g.c); m.s = m.s.concat(g.s);
  });
  return m;
}

// ---- precipitation: CPU-integrated, deterministic from seed ----
// drops: [{bx,bz,speed,len}], area half-extent, top spawn height.
function makeDrops(n, seed) {
  var d = [];
  for (var i = 0; i < n; i++) {
    d.push({
      bx: (rnd(seed + i * 3.7) - 0.5) * 30,
      bz: rnd(seed + i * 9.1 + 1) * 16 - 12,
      speed: 9 + rnd(seed + i * 5.3 + 2) * 5,
      len: 0.45 + rnd(seed + i * 7.9 + 3) * 0.45,
      off: rnd(seed + i * 11.3 + 4) * 16
    });
  }
  return d;
}
// Fill `arr` (Float32Array, n*2*3) with line-segment endpoints at time t.
function dropPositions(drops, t, arr, top, slant) {
  for (var i = 0; i < drops.length; i++) {
    var d = drops[i];
    var y = top - ((d.off + t * d.speed) % (top + 3));
    var x = d.bx + slant * (top - y) * 0.07;
    var o = i * 6;
    arr[o] = x; arr[o + 1] = y; arr[o + 2] = d.bz;
    arr[o + 3] = x - slant * 0.06; arr[o + 4] = y - d.len; arr[o + 5] = d.bz;
  }
  return arr;
}

function makeFlakes(n, seed) {
  var f = [];
  for (var i = 0; i < n; i++) {
    f.push({
      bx: (rnd(seed + 700 + i * 3.7) - 0.5) * 32,
      bz: rnd(seed + 800 + i * 9.1 + 1) * 22 - 13,
      speed: 0.7 + rnd(seed + 900 + i * 5.3 + 2) * 0.9,
      phase: rnd(seed + 1000 + i * 7.9 + 3) * Math.PI * 2,
      off: rnd(seed + 1100 + i * 11.3 + 4) * 15
    });
  }
  return f;
}
// Fill `arr` (Float32Array, n*3) with flake centers at time t.
function flakePositions(flakes, t, arr, top) {
  for (var i = 0; i < flakes.length; i++) {
    var f = flakes[i];
    var y = ((f.off - t * f.speed) % top + top) % top;
    var o = i * 3;
    arr[o] = f.bx + Math.sin(t * 0.8 + f.phase) * 1.2;
    arr[o + 1] = y + 0.3;
    arr[o + 2] = f.bz;
  }
  return arr;
}

// ---- shaders ----
var SKY_VSH = "attribute vec2 aXY; varying vec2 vUv;\n" +
  "void main(){ vUv = aXY * 0.5 + 0.5; gl_Position = vec4(aXY, 0.999, 1.0); }";
var SKY_FSH = "precision mediump float;\n" +
  "varying vec2 vUv;\n" +
  "uniform vec3 uTop; uniform vec3 uHorizon;\n" +
  "uniform vec2 uSun; uniform vec3 uSunCol; uniform float uSunI;\n" +
  "uniform vec2 uMoon; uniform float uNight;\n" +
  "uniform float uCloud; uniform vec3 uCloudCol;\n" +
  "uniform float uTime; uniform float uFlash;\n" +
  "float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n" +
  "void main(){\n" +
  "  vec3 col = mix(uHorizon, uTop, smoothstep(0.02, 0.75, vUv.y));\n" +
  "  float sd = distance(vUv, uSun);\n" +
  "  col += uSunCol * uSunI * (1.0 - uCloud * 0.9) *\n" +
  "    (exp(-sd * 7.0) * 0.9 + smoothstep(0.045, 0.02, sd) * 1.4);\n" +
  "  float md = distance(vUv, uMoon);\n" +
  "  col += vec3(0.85, 0.9, 1.0) * uNight * smoothstep(0.035, 0.015, md) * 0.9;\n" +
  "  col += vec3(0.75, 0.82, 0.95) * uNight * exp(-md * 14.0) * 0.25;\n" +
  // stars
  "  vec2 g = floor(vUv * vec2(160.0, 90.0));\n" +
  "  float st = step(0.992, hash(g)) * uNight * smoothstep(0.35, 0.8, vUv.y);\n" +
  "  col += vec3(st * (0.5 + 0.5 * hash(g + 7.0)));\n" +
  // drifting procedural cloud bands, upper sky only
  "  float band = sin(vUv.x * 9.0 + uTime * 0.05 + sin(vUv.y * 14.0 + uTime * 0.03) * 1.7)\n" +
  "             * sin(vUv.y * 7.0 - uTime * 0.04 + vUv.x * 3.0);\n" +
  "  float cover = smoothstep(1.15 - uCloud * 1.7, 2.05 - uCloud * 1.7, band)\n" +
  "              * smoothstep(0.15, 0.45, vUv.y) * step(0.01, uCloud);\n" +
  "  col = mix(col, uCloudCol, cover * 0.85);\n" +
  "  col += vec3(1.0, 1.0, 1.0) * uFlash * 0.55;\n" +
  "  gl_FragColor = vec4(col, 1.0);\n" +
  "}";

var WORLD_VSH = "precision mediump float;\n" +
  "attribute vec3 aPos; attribute vec3 aNor; attribute vec3 aCol; attribute vec2 aSway;\n" +
  "uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;\n" +
  "uniform float uTime; uniform float uWindAmp;\n" +
  "varying vec3 vCol; varying vec3 vNor; varying float vDist;\n" +
  "void main(){\n" +
  "  vec3 p = aPos;\n" +
  "  float sway = sin(uTime * 2.1 + aSway.x + aPos.x * 0.4 + aPos.z * 0.3);\n" +
  "  p.x += sway * aSway.y * aSway.y * uWindAmp;\n" +
  "  p.z += sway * aSway.y * aSway.y * uWindAmp * 0.6;\n" +
  "  vec4 wp = uModel * vec4(p, 1.0);\n" +
  "  vNor = normalize(mat3(uModel) * aNor);\n" +
  "  vCol = aCol;\n" +
  "  vec4 vp = uView * wp;\n" +
  "  vDist = length(vp.xyz);\n" +
  "  gl_Position = uProj * vp;\n" +
  "}";
var WORLD_FSH = "precision mediump float;\n" +
  "varying vec3 vCol; varying vec3 vNor; varying float vDist;\n" +
  "uniform vec3 uLightDir; uniform vec3 uLightCol; uniform float uAmb;\n" +
  "uniform vec3 uFogCol; uniform float uFogDen;\n" +
  "uniform vec3 uTint; uniform float uSnowMix; uniform float uFlash;\n" +
  "void main(){\n" +
  "  float diff = max(dot(normalize(vNor), normalize(uLightDir)), 0.0);\n" +
  "  vec3 col = vCol * (uAmb + uLightCol * diff);\n" +
  "  col *= uTint;\n" +
  "  col = mix(col, vec3(0.90, 0.92, 0.96) * (uAmb + uLightCol * 0.7), uSnowMix);\n" +
  "  float f = 1.0 - exp(-pow(vDist * uFogDen, 2.0));\n" +
  "  col = mix(col, uFogCol, clamp(f, 0.0, 1.0));\n" +
  "  col += vec3(1.0) * uFlash * 0.7;\n" +
  "  gl_FragColor = vec4(col, 1.0);\n" +
  "}";

var RAIN_VSH = "precision mediump float;\n" +
  "attribute vec3 aPos;\n" +
  "uniform mat4 uProj; uniform mat4 uView;\n" +
  "void main(){ gl_Position = uProj * uView * vec4(aPos, 1.0); }";
var RAIN_FSH = "precision mediump float;\n" +
  "uniform vec3 uCol; uniform float uAlpha;\n" +
  "void main(){ gl_FragColor = vec4(uCol, uAlpha); }";

var SNOW_VSH = "precision mediump float;\n" +
  "attribute vec3 aPos;\n" +
  "uniform mat4 uProj; uniform mat4 uView; uniform float uPx;\n" +
  "void main(){\n" +
  "  vec4 vp = uView * vec4(aPos, 1.0);\n" +
  "  gl_Position = uProj * vp;\n" +
  "  gl_PointSize = uPx * (14.0 / max(1.0, -vp.z));\n" +
  "}";
var SNOW_FSH = "precision mediump float;\n" +
  "uniform vec3 uCol; uniform float uAlpha;\n" +
  "void main(){\n" +
  "  vec2 d = gl_PointCoord - vec2(0.5);\n" +
  "  float a = smoothstep(0.5, 0.18, length(d)) * uAlpha;\n" +
  "  if (a < 0.01) discard;\n" +
  "  gl_FragColor = vec4(uCol, a);\n" +
  "}";

function compileShader(gl, type, src) {
  var sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error("shader");
  return sh;
}
function makeProg(gl, vsh, fsh) {
  var prog = gl.createProgram();
  gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsh));
  gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsh));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error("link");
  return prog;
}

function initGL(canvas) {
  var gl = null;
  try {
    gl = canvas.getContext("webgl", { alpha: false, antialias: true }) ||
         canvas.getContext("experimental-webgl");
  } catch (e) { gl = null; }
  if (!gl) return null;
  var G = { gl: gl };
  try {
    // sky (fullscreen triangle)
    var sp = makeProg(gl, SKY_VSH, SKY_FSH);
    gl.useProgram(sp);
    var sb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    var sxy = gl.getAttribLocation(sp, "aXY");
    gl.enableVertexAttribArray(sxy);
    gl.vertexAttribPointer(sxy, 2, gl.FLOAT, false, 0, 0);
    G.sky = {
      prog: sp, buf: sb,
      uTop: gl.getUniformLocation(sp, "uTop"), uHorizon: gl.getUniformLocation(sp, "uHorizon"),
      uSun: gl.getUniformLocation(sp, "uSun"), uSunCol: gl.getUniformLocation(sp, "uSunCol"),
      uSunI: gl.getUniformLocation(sp, "uSunI"), uMoon: gl.getUniformLocation(sp, "uMoon"),
      uNight: gl.getUniformLocation(sp, "uNight"), uCloud: gl.getUniformLocation(sp, "uCloud"),
      uCloudCol: gl.getUniformLocation(sp, "uCloudCol"), uTime: gl.getUniformLocation(sp, "uTime"),
      uFlash: gl.getUniformLocation(sp, "uFlash")
    };
    // world (ground + grass + flowers + rocks)
    var wp = makeProg(gl, WORLD_VSH, WORLD_FSH);
    gl.useProgram(wp);
    function wattr(name, size) {
      var loc = gl.getAttribLocation(wp, name);
      var buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      return buf;
    }
    G.world = {
      prog: wp,
      posBuf: wattr("aPos", 3), norBuf: wattr("aNor", 3),
      colBuf: wattr("aCol", 3), swayBuf: wattr("aSway", 2),
      uProj: gl.getUniformLocation(wp, "uProj"), uView: gl.getUniformLocation(wp, "uView"),
      uModel: gl.getUniformLocation(wp, "uModel"), uTime: gl.getUniformLocation(wp, "uTime"),
      uWindAmp: gl.getUniformLocation(wp, "uWindAmp"),
      uLightDir: gl.getUniformLocation(wp, "uLightDir"),
      uLightCol: gl.getUniformLocation(wp, "uLightCol"), uAmb: gl.getUniformLocation(wp, "uAmb"),
      uFogCol: gl.getUniformLocation(wp, "uFogCol"), uFogDen: gl.getUniformLocation(wp, "uFogDen"),
      uTint: gl.getUniformLocation(wp, "uTint"), uSnowMix: gl.getUniformLocation(wp, "uSnowMix"),
      uFlash: gl.getUniformLocation(wp, "uFlash")
    };
    // rain lines
    var rp = makeProg(gl, RAIN_VSH, RAIN_FSH);
    gl.useProgram(rp);
    var rloc = gl.getAttribLocation(rp, "aPos");
    var rbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, rbuf);
    gl.enableVertexAttribArray(rloc);
    gl.vertexAttribPointer(rloc, 3, gl.FLOAT, false, 0, 0);
    G.rain = {
      prog: rp, buf: rbuf, aPos: rloc,
      uProj: gl.getUniformLocation(rp, "uProj"), uView: gl.getUniformLocation(rp, "uView"),
      uCol: gl.getUniformLocation(rp, "uCol"), uAlpha: gl.getUniformLocation(rp, "uAlpha")
    };
    // snow points
    var np = makeProg(gl, SNOW_VSH, SNOW_FSH);
    gl.useProgram(np);
    var nloc = gl.getAttribLocation(np, "aPos");
    var nbuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nbuf);
    gl.enableVertexAttribArray(nloc);
    gl.vertexAttribPointer(nloc, 3, gl.FLOAT, false, 0, 0);
    G.snow = {
      prog: np, buf: nbuf, aPos: nloc,
      uProj: gl.getUniformLocation(np, "uProj"), uView: gl.getUniformLocation(np, "uView"),
      uCol: gl.getUniformLocation(np, "uCol"), uAlpha: gl.getUniformLocation(np, "uAlpha"),
      uPx: gl.getUniformLocation(np, "uPx")
    };
  } catch (e) { return null; }
  gl.enable(gl.DEPTH_TEST);
  gl.viewport(0, 0, canvas.width, canvas.height);
  var aspect = canvas.width / canvas.height;
  G.proj = m4persp(50, aspect, 0.1, 120);
  return G;
}

function uploadBuf(gl, buf, arr, dynamic) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr),
    dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
}

// ---- widget ----
var GRASS_COUNT = 4500, FLOWER_COUNT = 42, ROCK_COUNT = 11;
var RAIN_COUNT = 850, SNOW_COUNT = 650;
var MEADOW_SEED = 20260920;

function parseSunHMS(s) {
  // "2026-09-20T06:42" (timezone=auto => local ISO, no offset)
  if (typeof s !== "string") return null;
  var m = /T(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
}

function weatherSnapshot() {
  var w = (typeof window !== "undefined") ? window.__briefingWeather : null;
  if (!w || !w.current) return null;
  var code = (typeof w.current.weather_code === "number") ? w.current.weather_code : null;
  return {
    cond: conditionFor(code == null ? -1 : code),
    tempC: w.current.temp_c,
    desc: w.current.description || "—",
    icon: w.current.icon || "🌿",
    windKph: w.current.wind_kph || 0,
    srH: parseSunHMS(w.sun && w.sun.sunrise),
    ssH: parseSunHMS(w.sun && w.sun.sunset)
  };
}

function init() {
  var canvas = document.getElementById("meadow-canvas");
  if (!canvas) return;
  var wrap = document.getElementById("meadow-wrap");
  var fallback = document.getElementById("meadow-fallback");
  var statusEl = document.getElementById("meadow-status");

  var reduced = typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;

  var wx = weatherSnapshot();
  function renderStatus() {
    if (!statusEl) return;
    if (!wx) { statusEl.textContent = "🌿 reading the sky…"; return; }
    var t = (wx.tempC == null ? "" : " · " + wx.tempC + "°C");
    statusEl.textContent = wx.icon + " " + wx.desc + t;
    canvas.setAttribute("aria-label", "3D meadow: " + wx.desc +
      (wx.tempC == null ? "" : ", " + wx.tempC + " degrees"));
  }
  function onWeather() { wx = weatherSnapshot(); renderStatus(); }
  if (typeof window !== "undefined") {
    if (window.__briefingWeather) onWeather();
    window.addEventListener("briefing:weather", onWeather);
  }
  renderStatus();

  var G = initGL(canvas);
  if (!G) {
    if (wrap) wrap.style.display = "none";
    if (fallback) fallback.hidden = false;
    return;
  }
  var gl = G.gl;

  // static geometry, uploaded once
  var world = mergeMeshes([
    buildGround(),
    buildGrass(GRASS_COUNT, MEADOW_SEED),
    buildFlowers(FLOWER_COUNT, MEADOW_SEED + 7),
    buildRocks(ROCK_COUNT, MEADOW_SEED + 13)
  ]);
  gl.useProgram(G.world.prog);
  uploadBuf(gl, G.world.posBuf, world.p, false);
  uploadBuf(gl, G.world.norBuf, world.n, false);
  uploadBuf(gl, G.world.colBuf, world.c, false);
  uploadBuf(gl, G.world.swayBuf, world.s, false);
  var worldVerts = world.p.length / 3;
  gl.uniformMatrix4fv(G.world.uProj, false, G.proj);
  gl.uniformMatrix4fv(G.world.uModel, false,
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

  var drops = makeDrops(RAIN_COUNT, MEADOW_SEED + 21);
  var dropArr = new Float32Array(RAIN_COUNT * 6);
  var flakes = makeFlakes(SNOW_COUNT, MEADOW_SEED + 33);
  var flakeArr = new Float32Array(SNOW_COUNT * 3);

  var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
  function nowSec() {
    return ((typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000) - t0;
  }

  // lightning state (storm only, never under reduced motion)
  var flash = 0, nextFlash = 5;

  function frame(t) {
    var nowMs = Date.now();
    var h = nowMs / 3600000 % 24;
    var srH = wx && wx.srH != null ? wx.srH : 6;
    var ssH = wx && wx.ssH != null ? wx.ssH : 20;
    var phase = timePhase(h, srH, ssH);
    var night = phase === "night";
    var cond = wx ? wx.cond : { kind: "clear", intensity: 0 };
    var pal = skyPalette(phase, cond);

    var sun = sunDir(h, srH, ssH, night);
    var windKph = wx ? wx.windKph : 0;
    var windAmp = Math.min(1.6, 0.35 + windKph / 28);
    var windX = Math.min(6, windKph / 8);

    // lightning scheduling
    if (!reduced && cond.kind === "storm") {
      if (t > nextFlash) {
        flash = 1;
        nextFlash = t + 6 + Math.random() * 11;
      }
    } else if (cond.kind !== "storm") {
      flash = 0;
    }
    if (flash > 0 && !reduced) flash = Math.max(0, flash - 0.06);
    // double-pulse shape: quick decay reads as a flicker, not a strobe
    var flashV = flash > 0.55 ? (flash - 0.55) * 2.2 : flash * 0.5;

    // camera: slow calm drift (static when reduced)
    var ex = reduced ? 0 : Math.sin(t * 0.05) * 1.3;
    var ey = reduced ? 4.4 : 4.4 + Math.sin(t * 0.037) * 0.35;
    var ez = reduced ? 11.5 : 11.5 + Math.cos(t * 0.043) * 0.9;
    var view = m4lookAt([ex, ey, ez], [0, 1.0, -1], [0, 1, 0]);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // --- sky (depth off, fullscreen triangle) ---
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(G.sky.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.sky.buf);
    var sxy = gl.getAttribLocation(G.sky.prog, "aXY");
    gl.enableVertexAttribArray(sxy);
    gl.vertexAttribPointer(sxy, 2, gl.FLOAT, false, 0, 0);
    gl.uniform3fv(G.sky.uTop, pal.top);
    gl.uniform3fv(G.sky.uHorizon, pal.horizon);
    // project sun/moon direction to a plausible screen spot
    var sx = 0.5 + sun[0] * 0.42, sy = 0.42 + sun[1] * 0.5;
    if (night) {
      gl.uniform2f(G.sky.uSun, -1, -1); // no sun disc
      gl.uniform2f(G.sky.uMoon, 0.5 + sun[0] * 0.35, 0.45 + sun[1] * 0.45);
      gl.uniform1f(G.sky.uNight, 1);
    } else {
      gl.uniform2f(G.sky.uSun, sx, sy);
      gl.uniform2f(G.sky.uMoon, -1, -1);
      gl.uniform1f(G.sky.uNight, 0);
    }
    gl.uniform3fv(G.sky.uSunCol, pal.sunCol);
    gl.uniform1f(G.sky.uSunI, pal.sunI);
    gl.uniform1f(G.sky.uCloud, pal.cloud);
    gl.uniform3fv(G.sky.uCloudCol, night ? [0.10, 0.12, 0.18] : [0.82, 0.85, 0.89]);
    gl.uniform1f(G.sky.uTime, reduced ? 0 : t);
    gl.uniform1f(G.sky.uFlash, reduced ? 0 : flashV);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    // --- world ---
    gl.useProgram(G.world.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.world.posBuf);
    gl.enableVertexAttribArray(gl.getAttribLocation(G.world.prog, "aPos"));
    gl.vertexAttribPointer(gl.getAttribLocation(G.world.prog, "aPos"), 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.world.norBuf);
    gl.enableVertexAttribArray(gl.getAttribLocation(G.world.prog, "aNor"));
    gl.vertexAttribPointer(gl.getAttribLocation(G.world.prog, "aNor"), 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.world.colBuf);
    gl.enableVertexAttribArray(gl.getAttribLocation(G.world.prog, "aCol"));
    gl.vertexAttribPointer(gl.getAttribLocation(G.world.prog, "aCol"), 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, G.world.swayBuf);
    gl.enableVertexAttribArray(gl.getAttribLocation(G.world.prog, "aSway"));
    gl.vertexAttribPointer(gl.getAttribLocation(G.world.prog, "aSway"), 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(G.world.uView, false, view);
    gl.uniform1f(G.world.uTime, reduced ? 0 : t);
    gl.uniform1f(G.world.uWindAmp, reduced ? 0 : windAmp);
    gl.uniform3fv(G.world.uLightDir, sun);
    var lc = [pal.sunCol[0] * pal.sunI, pal.sunCol[1] * pal.sunI, pal.sunCol[2] * pal.sunI];
    gl.uniform3fv(G.world.uLightCol, lc);
    gl.uniform1f(G.world.uAmb, pal.amb);
    gl.uniform3fv(G.world.uFogCol, pal.fogCol);
    gl.uniform1f(G.world.uFogDen, pal.fogDen);
    gl.uniform3fv(G.world.uTint, pal.groundTint);
    gl.uniform1f(G.world.uSnowMix, pal.snowMix);
    gl.uniform1f(G.world.uFlash, reduced ? 0 : flashV);
    gl.drawArrays(gl.TRIANGLES, 0, worldVerts);

    // --- precipitation ---
    if (cond.kind === "rain" || cond.kind === "storm") {
      var inten = cond.kind === "storm" ? 0.9 : 0.25 + 0.75 * cond.intensity;
      var n = Math.floor(RAIN_COUNT * inten);
      dropPositions(drops, reduced ? 0 : t, dropArr, 13, windX);
      gl.useProgram(G.rain.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.rain.buf);
      gl.enableVertexAttribArray(G.rain.aPos);
      gl.vertexAttribPointer(G.rain.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(G.rain.uProj, false, G.proj);
      gl.uniformMatrix4fv(G.rain.uView, false, view);
      gl.uniform3f(G.rain.uCol, 0.65, 0.75, 0.9);
      gl.uniform1f(G.rain.uAlpha, night ? 0.45 : 0.62);
      uploadBuf(gl, G.rain.buf, dropArr.subarray(0, n * 6), true);
      gl.drawArrays(gl.LINES, 0, n * 2);
    } else if (cond.kind === "snow") {
      var ns = Math.floor(SNOW_COUNT * (0.3 + 0.7 * cond.intensity));
      flakePositions(flakes, reduced ? 0 : t, flakeArr, 14);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(G.snow.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, G.snow.buf);
      gl.enableVertexAttribArray(G.snow.aPos);
      gl.vertexAttribPointer(G.snow.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(G.snow.uProj, false, G.proj);
      gl.uniformMatrix4fv(G.snow.uView, false, view);
      gl.uniform3f(G.snow.uCol, 0.95, 0.96, 1.0);
      gl.uniform1f(G.snow.uAlpha, 0.9);
      gl.uniform1f(G.snow.uPx, 5 * (canvas.width / 900));
      uploadBuf(gl, G.snow.buf, flakeArr.subarray(0, ns * 3), true);
      gl.drawArrays(gl.POINTS, 0, ns);
      gl.disable(gl.BLEND);
    }
  }

  renderStatus();
  if (reduced) { frame(0); return; }
  (function loop() {
    frame(nowSec());
    requestAnimationFrame(loop);
  })();
  // Re-read weather on the minute so a changed forecast refreshes the scene.
  setInterval(onWeather, 60 * 1000);
}

// ---- test API ----
var api = {
  conditionFor: conditionFor, timePhase: timePhase, sunDir: sunDir,
  skyPalette: skyPalette, parseSunHMS: parseSunHMS,
  mixc: mixc, hexRGB: hexRGB, norm3: norm3, rnd: rnd,
  groundY: groundY, buildGround: buildGround, buildGrass: buildGrass,
  buildFlowers: buildFlowers, buildRocks: buildRocks, mergeMeshes: mergeMeshes,
  makeDrops: makeDrops, dropPositions: dropPositions,
  makeFlakes: makeFlakes, flakePositions: flakePositions,
  m4mul: m4mul, m4persp: m4persp, m4lookAt: m4lookAt,
  GRASS_COUNT: GRASS_COUNT, RAIN_COUNT: RAIN_COUNT, SNOW_COUNT: SNOW_COUNT
};
var root = typeof window !== "undefined" ? window : globalThis;
root.MeadowView = api;

if (typeof document !== "undefined" && document.getElementById("meadow-canvas")) {
  init();
}
})();
