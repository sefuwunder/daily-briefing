/* checks/drag-order.test.js — zero-dep node checks for public/drag-order.js.
 * Loads the REAL drag-order.js in a sandbox with no DOM globals (so its
 * auto-init stays dormant) and exercises the real exported functions
 * against fake grid/storage objects implementing the DOM surface the
 * functions actually use (children, appendChild, getAttribute, localStorage).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "public", "drag-order.js"), "utf8");

// Sandbox: no window/document -> the IIFE skips init(); module.exports picks up the API.
const sandbox = { module: { exports: {} }, console };
vm.createContext(sandbox);
vm.runInContext(src + "\n;module.exports;", sandbox);
const WO = sandbox.module.exports;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", name); }
}
function eq(a, b, name) { ok(JSON.stringify(a) === JSON.stringify(b), name + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }

// ---- fake DOM surface ----
function fakeCard(key) {
  return {
    _key: key,
    getAttribute(n) { return n === "data-widget" ? this._key : null; },
  };
}
function fakeGrid(keys) {
  const kids = keys.map(fakeCard);
  return {
    children: kids,
    appendChild(el) { // real DOM appendChild MOVES the node
      const i = kids.indexOf(el);
      if (i !== -1) kids.splice(i, 1);
      kids.push(el);
    },
    order() { return kids.map((k) => k._key); },
  };
}
function fakeStorage(initial) {
  const m = Object.assign({}, initial);
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    _map: m,
  };
}

const CURRENT = ["weather", "plant", "meadow", "tasks", "news", "mood", "nightsky", "pet", "bookmarks"];

// ---- sanitizeOrder ----
eq(WO.sanitizeOrder(["mood", "weather"], CURRENT),
   ["mood", "weather", "plant", "meadow", "tasks", "news", "nightsky", "pet", "bookmarks"],
   "sanitize: saved subset keeps order, rest appended");
eq(WO.sanitizeOrder(["nope", "weather", "zzz"], CURRENT)[0], "weather",
   "sanitize: unknown keys ignored");
eq(WO.sanitizeOrder(["weather", "weather", "news"], CURRENT).filter((k) => k === "weather").length, 1,
   "sanitize: duplicates removed");
eq(WO.sanitizeOrder(null, CURRENT), CURRENT, "sanitize: null saved -> current order");
eq(WO.sanitizeOrder("garbage", CURRENT), CURRENT, "sanitize: non-array saved -> current order");
// new widget added later appends at the end
eq(WO.sanitizeOrder(CURRENT.slice(0, 8), CURRENT.concat(["newbie"])).slice(-1), ["newbie"],
   "sanitize: new widget appends at end");

// ---- save/load round-trip ----
{
  const st = fakeStorage();
  ok(WO.saveOrder(["b", "a"], st), "saveOrder returns true");
  eq(WO.loadOrder(st), ["b", "a"], "loadOrder round-trips");
  eq(st._map[WO.ORDER_KEY], '["b","a"]', "storage payload is JSON array");
  ok(WO.ORDER_KEY === "briefing_widget_order", "storage key is briefing_widget_order");
}
eq(WO.loadOrder(fakeStorage()), null, "loadOrder: missing -> null");
eq(WO.loadOrder(fakeStorage({ [WO.ORDER_KEY]: "{bad json" })), null, "loadOrder: corrupt JSON -> null");
eq(WO.loadOrder(fakeStorage({ [WO.ORDER_KEY]: '"str"' })), null, "loadOrder: non-array -> null");
{
  const st = fakeStorage({ [WO.ORDER_KEY]: '["x"]' });
  WO.clearOrder(st);
  eq(WO.loadOrder(st), null, "clearOrder removes the key");
}
// storage throwing (private mode) must not throw
{
  const bad = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("denied"); }, removeItem() { throw new Error("denied"); } };
  eq(WO.loadOrder(bad), null, "loadOrder: throwing storage -> null, no throw");
  ok(WO.saveOrder(["a"], bad) === false, "saveOrder: throwing storage -> false, no throw");
  let threw = false;
  try { WO.clearOrder(bad); } catch (e) { threw = true; }
  ok(!threw, "clearOrder: throwing storage -> no throw");
}

// ---- applyOrder ----
{
  const g = fakeGrid(CURRENT);
  WO.applyOrder(g, ["mood", "weather", "plant", "meadow", "tasks", "news", "nightsky", "pet", "bookmarks"]);
  eq(g.order(), ["mood", "weather", "plant", "meadow", "tasks", "news", "nightsky", "pet", "bookmarks"],
     "applyOrder: full reorder");
}
{
  const g = fakeGrid(CURRENT);
  WO.applyOrder(g, ["pet", "nope", "weather"]); // unknown key skipped
  eq(g.order().slice(0, 2), ["pet", "weather"], "applyOrder: unknown keys ignored");
  eq(g.order().length, CURRENT.length, "applyOrder: no cards lost");
}
{
  const g = fakeGrid(CURRENT);
  WO.applyOrder(g, ["news"]); // partial: rest keep relative order at end
  eq(g.order(), ["news", "weather", "plant", "meadow", "tasks", "mood", "nightsky", "pet", "bookmarks"],
     "applyOrder: partial order, remainder stable");
}
{
  const g = fakeGrid(CURRENT);
  const before = g.order().join(",");
  WO.applyOrder(g, null);
  WO.applyOrder(null, ["weather"]);
  eq(g.order().join(","), before, "applyOrder: null-safe");
}
// keysOf reads data-widget in DOM order
{
  const g = fakeGrid(["a", "b"]);
  eq(WO.keysOf(g), ["a", "b"], "keysOf returns DOM order");
}

// ---- moveKey (keyboard) ----
eq(WO.moveKey(["a", "b", "c"], "b", -1), ["b", "a", "c"], "moveKey: up one");
eq(WO.moveKey(["a", "b", "c"], "b", 1), ["a", "c", "b"], "moveKey: down one");
eq(WO.moveKey(["a", "b", "c"], "a", -1), ["a", "b", "c"], "moveKey: clamped at top");
eq(WO.moveKey(["a", "b", "c"], "c", 5), ["a", "b", "c"], "moveKey: clamped at bottom");
eq(WO.moveKey(["a", "b", "c"], "a", 2), ["b", "c", "a"], "moveKey: jump to end");
eq(WO.moveKey(["a", "b", "c"], "zzz", 1), ["a", "b", "c"], "moveKey: unknown key -> unchanged copy");
{
  const orig = ["a", "b", "c"];
  WO.moveKey(orig, "b", 1);
  eq(orig, ["a", "b", "c"], "moveKey: does not mutate input");
}

// ---- integration: save -> "reload" -> apply ----
{
  const st = fakeStorage();
  WO.saveOrder(["pet", "weather"], st);
  const g = fakeGrid(CURRENT);
  WO.applyOrder(g, WO.sanitizeOrder(WO.loadOrder(st), WO.keysOf(g)));
  eq(g.order().slice(0, 2), ["pet", "weather"], "integration: order survives save/load/apply");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
