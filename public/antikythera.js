/* Antikythera — a living bronze celestial clock for the Morning Briefing.
 *
 * Ported from chronomancala's software-rendered lo-fi 3D Antikythera
 * (zero dependencies, Canvas 2D, flat-shaded polygon pipeline, PS1-style
 * vertex snapping). The gear train is the game's: a 48-tooth moon wheel,
 * satellite gears meshing at true ratios, a golden sun hand geared 12:1,
 * a silver moon hand, and a saros eclipse pointer — over fixed zodiac,
 * Greek-alphabet and bagua rings.
 *
 * Unlike the game, the hands here read the REAL sky: sun and moon ecliptic
 * longitudes and the true moon phase are computed from the current date
 * (degree-level astronomy, fine for a dashboard — not for navigation).
 * The wheel itself turns at a stately idle so the machine feels alive.
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.Antikythera = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ============================== astronomy ============================== */
  // Days since J2000.0 epoch helpers; longitudes in degrees.
  var SYNODIC = 29.530588853;                 // mean lunation, days
  var NEW_MOON_2000 = Date.UTC(2000, 0, 6, 18, 14);
  var SAROS_MONTHS = 223;                     // one saros = 223 lunations
  var SIGNS = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
               "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
  var PHASE_NAMES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous",
                     "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];

  // nowInfo(date?) -> { sunLon, moonLon, phase (0=new, 0.5=full), sign,
  //                     illum (0..1 lit fraction), phaseName, saros (0..1) }
  function nowInfo(date) {
    var now = date || new Date();
    var d = (now.getTime() - Date.UTC(2000, 0, 1, 12)) / 86400000;
    var L = (280.460 + 0.9856474 * d) % 360;                    // sun mean longitude
    var g = ((357.528 + 0.9856003 * d) % 360) * Math.PI / 180;  // sun mean anomaly
    var sunLon = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g) + 360) % 360;
    var moonLon = ((218.316 + 13.176396 * d) % 360 + 360) % 360;
    var months = (now.getTime() - NEW_MOON_2000) / 86400000 / SYNODIC;
    var phase = ((months % 1) + 1) % 1;
    var illum = (1 - Math.cos(phase * TAU)) / 2;
    var saros = (((months % SAROS_MONTHS) + SAROS_MONTHS) % SAROS_MONTHS) / SAROS_MONTHS;
    return {
      now: now, sunLon: sunLon, moonLon: moonLon, phase: phase,
      sign: SIGNS[Math.floor(sunLon / 30) % 12],
      illum: illum,
      phaseName: PHASE_NAMES[Math.floor(phase * 8 + 0.5) % 8],
      saros: saros
    };
  }

  /* ============================== 3d math ============================== */
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function norm3(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  // rotate point: rz (in-plane spin) first, then yaw around Y, then pitch around X
  function rotYX(p, ry, rx, rz) {
    var x = p[0], y = p[1], z = p[2], c, s, nx, ny, nz;
    if (rz) { c = Math.cos(rz); s = Math.sin(rz); nx = x * c - y * s; ny = x * s + y * c; x = nx; y = ny; }
    if (ry) { c = Math.cos(ry); s = Math.sin(ry); nx = x * c + z * s; nz = -x * s + z * c; x = nx; z = nz; }
    if (rx) { c = Math.cos(rx); s = Math.sin(rx); ny = y * c - z * s; nz = y * s + z * c; y = ny; z = nz; }
    return [x, y, z];
  }
  function shade(c, k) {
    return [clamp(c[0] * k, 0, 255) | 0, clamp(c[1] * k, 0, 255) | 0, clamp(c[2] * k, 0, 255) | 0];
  }
  function css(c) { return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; }

  /* ============================== meshes ============================== */
  // Mesh: { v: [[x,y,z]], f: [{ p:[i..], c:[r,g,b] }] } — convex faces, fan-triangulated at draw.
  function boxMesh(w, h, d, c) {
    var x = w / 2, y = h / 2, z = d / 2;
    var v = [[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]];
    var f = [
      { p: [3,7,6,2], c: c }, { p: [1,5,4,0], c: c }, { p: [5,6,7,4], c: c },
      { p: [0,3,2,1], c: c }, { p: [1,2,6,5], c: c }, { p: [4,7,3,0], c: c }
    ];
    return { v: v, f: f };
  }
  function cylMesh(r, h, seg, c) {
    var v = [], f = [], i, j, a;
    for (i = 0; i < seg; i++) {
      a = (i / seg) * TAU;
      v.push([Math.cos(a) * r, h / 2, Math.sin(a) * r]);
      v.push([Math.cos(a) * r, -h / 2, Math.sin(a) * r]);
    }
    var ct = v.length; v.push([0, h / 2, 0]);
    var cb = v.length; v.push([0, -h / 2, 0]);
    for (i = 0; i < seg; i++) {
      j = (i + 1) % seg; a = i * 2; var b = j * 2;
      f.push({ p: [ct, b, a], c: c });
      f.push({ p: [cb, a + 1, b + 1], c: c });
      f.push({ p: [a, b, b + 1], c: c });
      f.push({ p: [a, b + 1, a + 1], c: c });
    }
    return { v: v, f: f };
  }
  // Gear facing +Z: teeth around XY, extruded along Z.
  function gearMesh(teeth, rOut, rRoot, thick, c, hubR) {
    hubR = hubR || 0;
    var v = [], f = [], ring = [], i, j;
    var step = TAU / teeth;
    for (i = 0; i < teeth; i++) {
      var a0 = i * step;
      var prof = [[0, rRoot], [0.28, rOut], [0.55, rOut], [0.83, rRoot]];
      for (var k = 0; k < prof.length; k++) {
        var an = a0 + prof[k][0] * step;
        ring.push([Math.cos(an) * prof[k][1], Math.sin(an) * prof[k][1]]);
      }
    }
    var n = ring.length, zt = thick / 2;
    for (i = 0; i < n; i++) v.push([ring[i][0], ring[i][1], zt]);
    for (i = 0; i < n; i++) v.push([ring[i][0], ring[i][1], -zt]);
    var cTop = v.length; v.push([0, 0, zt]);
    var cBot = v.length; v.push([0, 0, -zt]);
    for (i = 0; i < n; i++) {
      j = (i + 1) % n;
      f.push({ p: [cTop, i, j], c: c });
      f.push({ p: [cBot, n + j, n + i], c: c });
      f.push({ p: [i, n + i, n + j], c: c });
      f.push({ p: [i, n + j, j], c: c });
    }
    var m = { v: v, f: f };
    if (hubR > 0) {
      var hub = cylMesh(hubR, thick * 1.6, 18, shade(c, 1.15));
      var off = v.length;
      for (i = 0; i < hub.v.length; i++) v.push(hub.v[i]);
      for (i = 0; i < hub.f.length; i++) {
        f.push({ p: hub.f[i].p.map(function (ix) { return ix + off; }), c: hub.f[i].c });
      }
    }
    return m;
  }
  // flat annulus (ring) in XZ plane
  function annulusMesh(rIn, rOut, seg, c) {
    var v = [], f = [], i, j, a;
    for (i = 0; i < seg; i++) {
      a = (i / seg) * TAU;
      v.push([Math.cos(a) * rIn, 0, Math.sin(a) * rIn]);
      v.push([Math.cos(a) * rOut, 0, Math.sin(a) * rOut]);
    }
    for (i = 0; i < seg; i++) {
      j = (i + 1) % seg; a = i * 2; var b = j * 2;
      f.push({ p: [a, b, b + 1], c: c });
      f.push({ p: [a, b + 1, a + 1], c: c });
    }
    return { v: v, f: f };
  }
  // hand: thin box pivoting at its base (extends +Y)
  function handMesh(len, wid, color) {
    var m = boxMesh(wid, len, 0.07, color);
    m.v = m.v.map(function (p) { return [p[0], p[1] + len / 2, p[2]]; });
    return m;
  }

  /* ============================== scene ============================== */
  var BRONZE = [176, 141, 87], BRONZE_DK = [122, 96, 58], VERDI = [67, 179, 162];
  var WHEEL = { x: 0, y: 5.2, z: -7.8, pitch: 3.24 };

  var instances = [];
  var gears = []; // { inst, ratio, phase, kind, off? }
  function addInst(mesh, pos, opts) {
    opts = opts || {};
    var inst = { mesh: mesh, pos: pos, ry: opts.ry || 0, rx: opts.rx || 0, rz: opts.rz || 0, tint: opts.tint || null };
    instances.push(inst);
    return inst;
  }

  function buildMechanism() {
    instances.length = 0; gears.length = 0;
    // FIXED zodiac ring — the clock face (does not rotate)
    addInst(annulusMesh(3.65, 4.08, 64, BRONZE_DK), [WHEEL.x, WHEEL.y, WHEEL.z], { rx: Math.PI / 2 });
    addInst(annulusMesh(3.5, 3.62, 64, BRONZE), [WHEEL.x, WHEEL.y, WHEEL.z + 0.3], { rx: Math.PI / 2 });
    // FIXED Taoist bagua ring — eight trigrams, outermost (does not rotate)
    addInst(annulusMesh(4.16, 4.52, 72, shade(BRONZE_DK, 0.72)), [WHEEL.x, WHEEL.y, WHEEL.z - 0.06], { rx: Math.PI / 2 });
    // main moon wheel (48T)
    var main = gearMesh(48, 3.5, 2.98, 0.5, BRONZE, 0.7);
    gears.push({ inst: addInst(main, [WHEEL.x, WHEEL.y, WHEEL.z], {}), ratio: 1, phase: 0, kind: "main" });
    // spokes so the wheel's turning reads clearly
    for (var s = 0; s < 4; s++) {
      var spoke = handMesh(2.85, 0.15, shade(BRONZE, 0.8));
      gears.push({ inst: addInst(spoke, [WHEEL.x, WHEEL.y, WHEEL.z + 0.28], {}), kind: "spoke", off: s * Math.PI / 2 });
    }
    // moon hand (silver) — tip carries the phase disc
    gears.push({ inst: addInst(handMesh(3.1, 0.13, [205, 215, 230]), [WHEEL.x, WHEEL.y, WHEEL.z + 0.38], {}), kind: "moonHand" });
    // sun hand (golden) — geared down 12:1 in the real machine
    gears.push({ inst: addInst(handMesh(3.35, 0.17, [235, 185, 85]), [WHEEL.x, WHEEL.y, WHEEL.z + 0.48], {}), kind: "sunHand" });
    // center cap
    addInst(cylMesh(0.3, 0.2, 16, BRONZE), [WHEEL.x, WHEEL.y, WHEEL.z + 0.55], { rx: Math.PI / 2 });
    // satellite gears meshing with the main wheel (true ratios, counter-rotating)
    var sats = [
      { t: 16, ang: 200 * Math.PI / 180 },
      { t: 12, ang: -20 * Math.PI / 180 },
      { t: 20, ang: 65 * Math.PI / 180 }
    ];
    for (var q = 0; q < sats.length; q++) {
      var st = sats[q];
      var r = WHEEL.pitch * (st.t / 48);
      var d = WHEEL.pitch + r;
      var gm = gearMesh(st.t, r * 1.08, r * 0.92, 0.4, st.t === 12 ? VERDI : BRONZE_DK, r * 0.32);
      var gi = addInst(gm, [WHEEL.x + Math.cos(st.ang) * d, WHEEL.y + Math.sin(st.ang) * d, WHEEL.z], {});
      gears.push({ inst: gi, ratio: -48 / st.t, phase: Math.PI / st.t, kind: "sat" });
    }
    // saros eclipse pointer — one revolution per saros cycle
    gears.push({ inst: addInst(handMesh(2.2, 0.12, VERDI), [WHEEL.x, WHEEL.y, WHEEL.z + 0.58], {}), kind: "saros" });
    gears.push({ inst: addInst(cylMesh(0.32, 0.16, 16, [20, 22, 34]), [0, 0, 0], { rx: Math.PI / 2 }), kind: "sarosEye" });
  }

  // gear angles for a given wheel angle + sky state (pure; used by checks)
  function gearAngles(wheel, info) {
    var out = [];
    for (var i = 0; i < gears.length; i++) {
      var g = gears[i];
      if (g.kind === "main") out.push(wheel);
      else if (g.kind === "spoke") out.push(wheel + g.off - Math.PI / 2);
      else if (g.kind === "sat") out.push(wheel * g.ratio + g.phase);
      else if (g.kind === "moonHand") out.push(info.moonLon * Math.PI / 180 - Math.PI / 2);
      else if (g.kind === "sunHand") out.push(info.sunLon * Math.PI / 180 - Math.PI / 2);
      else if (g.kind === "saros") out.push(info.saros * TAU - Math.PI / 2);
      else if (g.kind === "sarosEye") out.push(info.saros * TAU);
    }
    return out;
  }

  /* ============================== renderer ============================== */
  var LIGHT = norm3([-0.45, 0.8, 0.55]);
  var RIM = norm3([0.5, 0.2, -0.7]);

  // camera (chronomancala clock framing, f rescaled to the widget on resize)
  var cam = { pos: [0, 5.2, 7.0], look: [0, 5.2, -7.8], f: 560 };
  function camBasis() {
    var fwd = norm3(sub3(cam.look, cam.pos));
    var right = norm3(cross3(fwd, [0, 1, 0]));
    var up = cross3(right, fwd);
    return { fwd: fwd, right: right, up: up };
  }

  var view = { w: 0, h: 0, reduced: false };
  function project(p, B) {
    var d = sub3(p, cam.pos);
    var z = dot3(d, B.fwd), x = dot3(d, B.right), y = dot3(d, B.up);
    if (z < 0.5) return null;
    var sx = view.w / 2 + (x / z) * cam.f;
    var sy = view.h / 2 - (y / z) * cam.f;
    if (!view.reduced) { sx = Math.round(sx); sy = Math.round(sy); } // PS1 snap
    return [sx, sy, z];
  }

  function renderScene(ctx, B) {
    var tris = [];
    for (var ii = 0; ii < instances.length; ii++) {
      var inst = instances[ii];
      var mesh = inst.mesh, pos = inst.pos;
      var wv = new Array(mesh.v.length);
      for (var i = 0; i < mesh.v.length; i++) {
        var r = rotYX(mesh.v[i], inst.ry || 0, inst.rx || 0, inst.rz || 0);
        wv[i] = [r[0] + pos[0], r[1] + pos[1], r[2] + pos[2]];
      }
      for (var fi = 0; fi < mesh.f.length; fi++) {
        var fc = mesh.f[fi];
        var p0 = wv[fc.p[0]], p1 = wv[fc.p[1]], p2 = wv[fc.p[2]];
        var n = norm3(cross3(sub3(p1, p0), sub3(p2, p0)));
        var toCam = norm3(sub3(cam.pos, p0));
        if (dot3(n, toCam) <= 0.02) continue;
        var z = 0, sp = [], ok = true;
        for (var pi = 0; pi < fc.p.length; pi++) {
          var s = project(wv[fc.p[pi]], B);
          if (!s) { ok = false; break; }
          sp.push(s); z += s[2];
        }
        if (!ok) continue;
        var dl = Math.max(0, dot3(n, LIGHT));
        var rl = Math.max(0, dot3(n, RIM)) * 0.35;
        var base = inst.tint ? shade(inst.tint, 1) : fc.c;
        tris.push({ sp: sp, z: z / fc.p.length, c: shade(base, 0.32 + 0.68 * dl + rl) });
      }
    }
    tris.sort(function (a, b) { return b.z - a.z; });
    ctx.lineWidth = 1;
    for (var ti = 0; ti < tris.length; ti++) {
      var t = tris[ti];
      ctx.beginPath();
      ctx.moveTo(t.sp[0][0], t.sp[0][1]);
      for (var li = 1; li < t.sp.length; li++) ctx.lineTo(t.sp[li][0], t.sp[li][1]);
      ctx.closePath();
      ctx.fillStyle = css(t.c);
      ctx.fill();
    }
  }

  /* ============================== face overlays ============================== */
  var ASTRO = ["♈︎","♉︎","♊︎","♋︎","♌︎","♍︎","♎︎","♏︎","♐︎","♑︎","♒︎","♓︎"];
  var GREEK = ["Α","Β","Γ","Δ","Ε","Ζ","Η","Θ","Ι","Κ","Λ","Μ","Ν","Ξ","Ο","Π","Ρ","Σ","Τ","Υ","Φ","Χ","Ψ","Ω"];
  var BAGUA = ["☰", "☱", "☲", "☳", "☴", "☵", "☶", "☷"];
  // dikenga: four moments of the sun (Kongo cosmogram)
  var DIKENGA = [
    { name: "KALA", a0: 45 * Math.PI / 180, a1: 135 * Math.PI / 180, c: "#4a4a4a", lc: "#9a9a9a" },
    { name: "TUKULA", a0: -45 * Math.PI / 180, a1: 45 * Math.PI / 180, c: "#b03a2a", lc: "#d06a5a" },
    { name: "LUVEMBA", a0: 225 * Math.PI / 180, a1: 315 * Math.PI / 180, c: "#d8d8d8", lc: "#e8e8e8" },
    { name: "MUSONI", a0: 135 * Math.PI / 180, a1: 225 * Math.PI / 180, c: "#c9971f", lc: "#d9ab3a" }
  ];
  function strokeArc3D(ctx, B, cx, cy, cz, r, a0, a1, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    var started = false;
    for (var a = a0; a <= a1 + 0.001; a += 0.06) {
      var p = project([cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz], B);
      if (!p) continue;
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; }
      else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
  }

  function drawFace(ctx, B, info) {
    var i, a, p, p1, p2;
    // 48 tick marks around the fixed ring
    for (i = 0; i < 48; i++) {
      a = (i / 48) * TAU;
      var major = i % 4 === 0;
      var r1 = major ? 3.6 : 3.74, r2 = 4.1;
      p1 = project([WHEEL.x + Math.cos(a) * r1, WHEEL.y + Math.sin(a) * r1, WHEEL.z + 0.08], B);
      p2 = project([WHEEL.x + Math.cos(a) * r2, WHEEL.y + Math.sin(a) * r2, WHEEL.z + 0.08], B);
      if (!p1 || !p2) continue;
      ctx.strokeStyle = "rgba(215,175,95," + (major ? 0.95 : 0.45) + ")";
      ctx.lineWidth = major ? 2.5 : 1;
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
    }
    // zodiac glyphs on the ring (fixed)
    var fs = Math.max(10, view.w * 0.055);
    ctx.font = fs + "px 'Segoe UI Symbol','Noto Sans Symbols 2','DejaVu Sans',sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (i = 0; i < 12; i++) {
      a = (i / 12) * TAU + TAU / 24;
      p = project([WHEEL.x + Math.cos(a) * 3.87, WHEEL.y + Math.sin(a) * 3.87, WHEEL.z + 0.08], B);
      if (!p) continue;
      ctx.fillStyle = "rgba(242,224,165,0.98)";
      ctx.fillText(ASTRO[i], p[0], p[1]);
    }
    // Greek alphabet — 24 letters on the bezel (fixed)
    ctx.font = "600 " + Math.max(7, view.w * 0.028) + "px Georgia, serif";
    for (i = 0; i < 24; i++) {
      a = (i / 24) * TAU + TAU / 48;
      p = project([WHEEL.x + Math.cos(a) * 3.56, WHEEL.y + Math.sin(a) * 3.56, WHEEL.z + 0.32], B);
      if (!p) continue;
      ctx.fillStyle = "rgba(216,196,140,0.85)";
      ctx.fillText(GREEK[i], p[0], p[1]);
    }
    // bagua trigrams on the outer ring (fixed)
    ctx.font = fs + "px Georgia, serif";
    for (i = 0; i < 8; i++) {
      a = (i / 8) * TAU + TAU / 16;
      p = project([WHEEL.x + Math.cos(a) * 4.34, WHEEL.y + Math.sin(a) * 4.34, WHEEL.z], B);
      if (!p) continue;
      ctx.fillStyle = "rgba(168,205,190,0.92)";
      ctx.fillText(BAGUA[i], p[0], p[1]);
    }
    // dikenga cross + arcs + labels (fixed)
    var dz = WHEEL.z + 0.14;
    ctx.strokeStyle = "rgba(200,190,170,0.35)"; ctx.lineWidth = 1;
    var tp = project([WHEEL.x, WHEEL.y + 2.95, dz], B), bp = project([WHEEL.x, WHEEL.y - 2.95, dz], B);
    var lp = project([WHEEL.x - 2.95, WHEEL.y, dz], B), rp = project([WHEEL.x + 2.95, WHEEL.y, dz], B);
    if (tp && bp) { ctx.beginPath(); ctx.moveTo(tp[0], tp[1]); ctx.lineTo(bp[0], bp[1]); ctx.stroke(); }
    if (lp && rp) { ctx.beginPath(); ctx.moveTo(lp[0], lp[1]); ctx.lineTo(rp[0], rp[1]); ctx.stroke(); }
    for (i = 0; i < DIKENGA.length; i++) {
      var m = DIKENGA[i];
      strokeArc3D(ctx, B, WHEEL.x, WHEEL.y, dz, 2.82, m.a0, m.a1, m.c, 5);
      var la = (m.a0 + m.a1) / 2;
      var lp2 = project([WHEEL.x + Math.cos(la) * 2.38, WHEEL.y + Math.sin(la) * 2.38, dz], B);
      if (lp2) {
        ctx.font = "600 " + Math.max(6, view.w * 0.025) + "px Georgia, serif";
        ctx.fillStyle = m.lc;
        ctx.fillText(m.name, lp2[0], lp2[1]);
      }
    }
    // sun disc at the sun hand's tip (golden, rayed)
    var sa = info.sunLon * Math.PI / 180;
    var sp = project([WHEEL.x + Math.cos(sa) * 3.35, WHEEL.y + Math.sin(sa) * 3.35, WHEEL.z + 0.5], B);
    if (sp) {
      ctx.strokeStyle = "rgba(255,200,90,0.85)"; ctx.lineWidth = 2;
      for (var r = 0; r < 8; r++) {
        var ra = (r / 8) * TAU + sa;
        ctx.beginPath();
        ctx.moveTo(sp[0] + Math.cos(ra) * 11, sp[1] + Math.sin(ra) * 11);
        ctx.lineTo(sp[0] + Math.cos(ra) * 17, sp[1] + Math.sin(ra) * 17);
        ctx.stroke();
      }
      var grd = ctx.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], 13);
      grd.addColorStop(0, "rgba(255,232,155,1)");
      grd.addColorStop(1, "rgba(255,180,60,0)");
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 13, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(255,214,115,1)";
      ctx.beginPath(); ctx.arc(sp[0], sp[1], 7, 0, TAU); ctx.fill();
    }
    // moon disc at the moon hand's tip, shaded by the true phase
    var ma = info.moonLon * Math.PI / 180;
    var mp = project([WHEEL.x + Math.cos(ma) * 3.1, WHEEL.y + Math.sin(ma) * 3.1, WHEEL.z + 0.4], B);
    if (mp) {
      var bright = Math.sin(info.phase * Math.PI);
      ctx.fillStyle = "rgba(28,30,42,0.95)";
      ctx.beginPath(); ctx.arc(mp[0], mp[1], 9, 0, TAU); ctx.fill();
      var mb = Math.round(60 + 170 * bright);
      ctx.fillStyle = "rgba(" + mb + "," + mb + "," + Math.min(255, mb + 12) + ",0.95)";
      ctx.beginPath(); ctx.arc(mp[0], mp[1], 3 + 6 * bright, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(205,215,230,0.7)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(mp[0], mp[1], 9, 0, TAU); ctx.stroke();
    }
    // saros eclipse eye
    var ea = info.saros * TAU;
    var ep = project([WHEEL.x + Math.cos(ea) * 2.2, WHEEL.y + Math.sin(ea) * 2.2, WHEEL.z + 0.6], B);
    if (ep) {
      ctx.fillStyle = "rgba(14,14,24,0.96)";
      ctx.beginPath(); ctx.arc(ep[0], ep[1], 10, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(255,179,71,0.95)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(ep[0], ep[1], 13, 0, TAU); ctx.stroke();
      ctx.strokeStyle = "rgba(255,179,71,0.35)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(ep[0], ep[1], 18, 0, TAU); ctx.stroke();
    }
  }

  /* ============================== widget ============================== */
  function init() {
    var canvas = document.getElementById("antikythera-canvas");
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    var readout = document.getElementById("antikythera-readout");
    var signBadge = document.getElementById("antikythera-sign");
    view.reduced = typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;

    buildMechanism();

    // starfield (seeded layout, twinkles unless reduced motion)
    var stars = [];
    var seed = 7;
    function rnd() { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }
    for (var i = 0; i < 110; i++) {
      stars.push({ x: rnd(), y: rnd(), r: rnd() * 1.3 + 0.3, p: rnd() * TAU, s: 0.5 + rnd() * 1.5 });
    }

    var W = 0, H = 0;
    function resize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      var w = canvas.clientWidth || 320;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(w * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = w; H = w;
      view.w = W; view.h = H;
      cam.f = W * 1.42; // frame the 4.52-radius face in the square canvas
    }
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(resize).observe(canvas);
    else if (typeof addEventListener !== "undefined") addEventListener("resize", resize);

    function drawBackground(t) {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, "rgb(11,14,26)");
      g.addColorStop(0.6, "rgb(7,8,18)");
      g.addColorStop(1, "rgb(5,6,13)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        var tw = view.reduced ? 0.7 : 0.45 + 0.35 * Math.sin(t * 0.001 * s.s + s.p);
        ctx.globalAlpha = tw;
        ctx.fillRect(s.x * W, s.y * H, s.r, s.r);
      }
      ctx.globalAlpha = 1;
    }

    var wheel = 0, lastT = 0, visible = true, lastInfoMin = -1;
    function updateReadout(info) {
      if (signBadge) signBadge.textContent = "☀ " + info.sign;
      if (readout) {
        readout.textContent =
          "Sun in " + info.sign + " · " + info.phaseName + ", " +
          Math.round(info.illum * 100) + "% lit · saros cycle " +
          Math.round(info.saros * 100) + "% — hands read the real sky.";
      }
    }
    function frame(t) {
      requestAnimationFrame(frame);
      if (!visible || !W) return;
      var dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
      lastT = t;
      if (!view.reduced) wheel += dt * 0.05; // one revolution ≈ 2 minutes
      var info = nowInfo();
      var angles = gearAngles(wheel, info);
      for (var i = 0; i < gears.length; i++) {
        var g = gears[i];
        if (g.kind === "sarosEye") {
          g.inst.pos = [WHEEL.x + Math.cos(angles[i]) * 2.2, WHEEL.y + Math.sin(angles[i]) * 2.2, WHEEL.z + 0.62];
        } else {
          g.inst.rz = angles[i];
        }
      }
      drawBackground(t);
      var B = camBasis();
      renderScene(ctx, B);
      drawFace(ctx, B, info);
      var minute = info.now.getMinutes() + info.now.getHours() * 60;
      if (minute !== lastInfoMin) { lastInfoMin = minute; updateReadout(info); }
    }
    if (typeof IntersectionObserver !== "undefined") {
      new IntersectionObserver(function (es) {
        for (var i = 0; i < es.length; i++) visible = es[i].isIntersecting;
      }).observe(canvas);
    }
    resize();
    updateReadout(nowInfo());
    requestAnimationFrame(frame);
  }

  buildMechanism(); // so gearAngles()/checks work without a DOM

  var api = {
    nowInfo: nowInfo,
    gearAngles: gearAngles,
    gearMesh: gearMesh,
    annulusMesh: annulusMesh,
    rotYX: rotYX,
    SIGNS: SIGNS,
    PHASE_NAMES: PHASE_NAMES,
    SAROS_MONTHS: SAROS_MONTHS,
    gearCount: function () { return gears.length; },
    instanceCount: function () { return instances.length; }
  };
  if (typeof document !== "undefined" && document.getElementById("antikythera-canvas")) init();
  return api;
});
