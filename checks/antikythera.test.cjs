/* checks/antikythera.test.cjs — zero-dep node checks for public/antikythera.js.
 * Loads the REAL antikythera.js in a sandbox with no DOM globals (so its
 * auto-init stays dormant) and exercises the exported pure logic:
 * astronomy ranges/known dates, gear ratios, mesh sanity.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "antikythera.js"), "utf8");

const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(src + "\n;module.exports;", sandbox);
const A = sandbox.module.exports;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}
function near(a, b, tol, name) {
  ok(Math.abs(a - b) <= tol, name + " (got " + a + ", want ~" + b + " ±" + tol + ")");
}
function eq(a, b, name) {
  ok(JSON.stringify(a) === JSON.stringify(b),
     name + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
}

// ---- astronomy: known reference points ----
// Full moon: Jan 6, 2000 ~18:14 UTC was the epoch NEW moon; +14.77d ≈ full.
const newMoon = A.nowInfo(new Date(Date.UTC(2000, 0, 6, 18, 14)));
near(newMoon.phase, 0, 0.02, "epoch new moon phase ≈ 0");
near(newMoon.illum, 0, 0.02, "new moon illum ≈ 0");
const fullMoon = A.nowInfo(new Date(Date.UTC(2000, 0, 6, 18, 14) + 14.77 * 86400000));
near(fullMoon.phase, 0.5, 0.02, "half-lunation phase ≈ 0.5");
near(fullMoon.illum, 1, 0.02, "full moon illum ≈ 1");
ok(fullMoon.phaseName === "Full moon", "full moon phase name");

// Sun longitude: ~Sep 22 equinox → Libra boundary (180°)
const equinox = A.nowInfo(new Date(Date.UTC(2026, 8, 22, 12, 0)));
near(equinox.sunLon, 180, 3, "autumn equinox sunLon ≈ 180");
ok(equinox.sign === "Libra" || equinox.sign === "Virgo", "equinox sign Virgo/Libra, got " + equinox.sign);

// Saros: one full saros after the epoch new moon returns to ~same fraction.
const sarosLater = A.nowInfo(new Date(Date.UTC(2000, 0, 6, 18, 14) + 223 * 29.530588853 * 86400000));
const sarosDiff = Math.abs(sarosLater.saros - newMoon.saros);
near(Math.min(sarosDiff, 1 - sarosDiff), 0, 0.01, "saros wraps after 223 lunations");

// Ranges hold for a spread of dates.
for (let i = 0; i < 40; i++) {
  const info = A.nowInfo(new Date(Date.UTC(2024, 0, 1) + i * 37 * 86400000));
  ok(info.sunLon >= 0 && info.sunLon < 360, "sunLon in [0,360)");
  ok(info.moonLon >= 0 && info.moonLon < 360, "moonLon in [0,360)");
  ok(info.phase >= 0 && info.phase < 1, "phase in [0,1)");
  ok(info.illum >= 0 && info.illum <= 1, "illum in [0,1]");
  ok(info.saros >= 0 && info.saros < 1, "saros in [0,1)");
  ok(A.SIGNS.indexOf(info.sign) !== -1, "sign is a zodiac sign");
}

// ---- gear train ----
// build order: [main, spoke×4, moonHand, sunHand, sat16, sat12, sat20, saros, sarosEye]
ok(A.gearCount() === 12, "12 gear entries, got " + A.gearCount());
ok(A.instanceCount() === 16, "16 instances (3 rings + wheel + 4 spokes + 2 hands + cap + 3 sats + pointer + eye), got " + A.instanceCount());

const info = A.nowInfo(new Date(Date.UTC(2026, 9, 20, 12, 0)));
const w = 0.7;
const angs = A.gearAngles(w, info);
ok(angs.length === A.gearCount(), "gearAngles returns one angle per gear");
near(angs[0], w, 1e-9, "main wheel angle = wheel");
near(angs[7], w * -3 + Math.PI / 16, 1e-9, "16T satellite ratio -48/16 = -3");
near(angs[8], w * -4 + Math.PI / 12, 1e-9, "12T satellite ratio -48/12 = -4");
near(angs[9], w * -2.4 + Math.PI / 20, 1e-9, "20T satellite ratio -48/20 = -2.4");
// hands read the sky
near(angs[5], info.moonLon * Math.PI / 180 - Math.PI / 2, 1e-9, "moon hand = moon longitude");
near(angs[6], info.sunLon * Math.PI / 180 - Math.PI / 2, 1e-9, "sun hand = sun longitude");

// ---- meshes ----
const g48 = A.gearMesh(48, 3.5, 2.98, 0.5, [1, 2, 3], 0.7);
ok(g48.v.length > 48 * 4 * 2, "48T gear has ring verts both faces + hub");
ok(g48.f.length > 48 * 4, "48T gear faces present");
let finite = true;
for (const v of g48.v) for (const x of v) if (!isFinite(x)) finite = false;
for (const f of g48.f) for (const ix of f.p) if (ix < 0 || ix >= g48.v.length) finite = false;
ok(finite, "gear verts finite, face indices in range");

const ring = A.annulusMesh(3.65, 4.08, 64, [1, 2, 3]);
ok(ring.v.length === 128 && ring.f.length === 128, "annulus 64-seg verts/faces");

// rotYX: full turns are identity; rz rotates in-plane
const p = A.rotYX([1, 0, 0], 0, 0, Math.PI / 2);
near(p[0], 0, 1e-9, "rotYX rz 90° x→0");
near(p[1], 1, 1e-9, "rotYX rz 90° y→1");

// ---- Odù Ifá ----
ok(A.ODU_MEJI.length === 16, "16 meji odù");
const seenBits = {};
for (const o of A.ODU_MEJI) {
  ok(o.bits.length === 4 && o.bits.every((b) => b === 0 || b === 1), o.stem + " has 4 binary marks");
  const key = o.bits.join("");
  ok(!seenBits[key], o.stem + " pattern unique");
  seenBits[key] = o.stem;
}
ok(Object.keys(seenBits).length === 16, "all 16 possible 4-mark patterns present exactly once");
eq(A.ODU_MEJI[0].bits, [1, 1, 1, 1], "Eji Ogbe = all single marks");
eq(A.ODU_MEJI[1].bits, [0, 0, 0, 0], "Oyeku = all double marks");
eq(A.ODU_MEJI.map((o) => o.stem),
   ["Ogbe", "Oyeku", "Iwori", "Odi", "Irosun", "Owonrin", "Obara", "Okanran",
    "Ogunda", "Osa", "Ika", "Oturupon", "Otura", "Irete", "Ose", "Ofun"],
   "seniority order");
// mirror pairs: reversing the column maps one odù to its partner
function rev(b) { return b.slice().reverse(); }
const pairs = [[4, 5], [6, 7], [8, 9], [10, 11], [12, 13], [14, 15]];
for (const [a, b] of pairs) {
  eq(rev(A.ODU_MEJI[a].bits), A.ODU_MEJI[b].bits,
     A.ODU_MEJI[a].stem + " reversed = " + A.ODU_MEJI[b].stem);
}
for (const i of [0, 1, 2, 3]) {
  eq(rev(A.ODU_MEJI[i].bits), A.ODU_MEJI[i].bits, A.ODU_MEJI[i].stem + " is a palindrome");
}
// odù of the day: deterministic, cycles through all 256 combinations
const day0 = new Date(2026, 0, 1);
eq(A.oduOfDay(day0), A.oduOfDay(new Date(2026, 0, 1)), "oduOfDay deterministic");
const combos = {}, mejis = {};
for (let i = 0; i < 256; i++) {
  const o = A.oduOfDay(new Date(day0.getTime() + i * 86400000));
  combos[o.right + ":" + o.left] = 1;
  if (o.meji) {
    mejis[o.right] = 1;
    ok(o.name === A.ODU_MEJI[o.right].name, "meji day named " + o.name);
  } else {
    ok(o.name === A.ODU_MEJI[o.right].stem + " " + A.ODU_MEJI[o.left].stem,
       "combo named right-left: " + o.name);
  }
}
ok(Object.keys(combos).length === 256, "256 days cover all 256 combinations");
ok(Object.keys(mejis).length === 16, "each meji leads exactly once per cycle");
// figure drawing: count stroke segments via a fake ctx (single=1, double=2 per mark)
function countSegments(bits) {
  let moveTo = 0;
  const fx = { strokeStyle: "", lineWidth: 1, lineCap: "",
               beginPath() {}, moveTo() { moveTo++; }, lineTo() {}, stroke() {} };
  A.drawOduFigure(fx, 100, 100, 40, bits, "#fff");
  return moveTo;
}
ok(countSegments([1, 1, 1, 1]) === 8, "Ogbe figure: 8 single strokes");
ok(countSegments([0, 0, 0, 0]) === 16, "Oyeku figure: 16 strokes (all double)");
ok(countSegments([0, 1, 1, 0]) === 12, "Iwori figure: 12 strokes");

console.log("antikythera checks: " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
