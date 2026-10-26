// checks/opml-feeds.test.ts — bun:test checks for src/opml.ts.
// Run: bun test checks/opml-feeds.test.ts
// The live-feed counts below mirror the drift check that cleared the
// OPML wiring: the OPML's four live groups must equal the dashboard's
// old hardcoded list exactly, and the proposed group must never leak in.

import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseOpml } from "../src/opml.ts";

const OPML = readFileSync(join(import.meta.dir, "..", "arts-feeds.opml"), "utf8");

const PROPOSED_URLS = [
  "https://opencountrymag.com/feed/",
  "https://artillerymag.com/feed/",
  "https://africandigitalart.com/feed/",
  "https://neweast.art/feed/",
  "https://iqhawemagazine.com/feed/",
  "https://soundsandcolours.com/feed/",
];

describe("real arts-feeds.opml", () => {
  const feeds = parseOpml(OPML);

  test("live group counts", () => {
    expect(feeds.caricom.length).toBe(15);
    expect(feeds.africa.length).toBe(23);
    expect(feeds.easteurope.length).toBe(7);
    expect(feeds.artdiy.length).toBe(9);
    expect(Object.keys(feeds).sort()).toEqual([
      "africa",
      "artdiy",
      "caricom",
      "easteurope",
    ]);
  });

  test("proposed group never leaks in", () => {
    const urls = Object.values(feeds).flat().map((f) => f.url);
    for (const u of PROPOSED_URLS) expect(urls).not.toContain(u);
    expect(urls.length).toBe(54);
  });

  test("noFilter flags", () => {
    const byUrl = new Map(
      Object.values(feeds).flat().map((f) => [f.url, f] as const)
    );
    expect(byUrl.get("https://iselemagazine.com/feed/")?.noFilter).toBe(true);
    expect(byUrl.get("https://kalaharireview.com/feed/")?.noFilter).toBe(true);
    expect(byUrl.get("https://artindexafrica.substack.com/feed")?.noFilter).toBeUndefined();
    expect(byUrl.get("https://www.largeup.com/feed/")?.noFilter).toBeUndefined();
    expect(
      byUrl.get("https://medium.com/@caribbeancollectivemagazine/feed")?.noFilter
    ).toBe(true);
  });

  test("every feed has a source and an http(s) url", () => {
    for (const f of Object.values(feeds).flat()) {
      expect(f.source.length).toBeGreaterThan(0);
      expect(f.url).toMatch(/^https?:\/\//);
    }
  });
});

describe("parseOpml edge cases", () => {
  test("entity unescaping, unknown groups, missing urls, dupes", () => {
    const feeds = parseOpml(`<?xml version="1.0"?>
<opml><body>
  <outline text="africa">
    <outline text="A" xmlUrl="https://example.com/feed?a=1&amp;b=2" />
    <outline text="A again" xmlUrl="https://example.com/feed?a=1&amp;b=2" />
    <outline text="NoUrl" />
  </outline>
  <outline text="proposed">
    <outline text="P" xmlUrl="https://example.com/proposed/feed" />
  </outline>
  <outline text="mystery-region">
    <outline text="M" xmlUrl="https://example.com/mystery/feed" />
  </outline>
  <outline text="Orphan" xmlUrl="https://example.com/orphan/feed" />
</body></opml>`);
    expect(feeds.africa.length).toBe(1);
    expect(feeds.africa[0].url).toBe("https://example.com/feed?a=1&b=2");
    expect(feeds.africa[0].source).toBe("A");
    const urls = Object.values(feeds).flat().map((f) => f.url);
    expect(urls).not.toContain("https://example.com/proposed/feed");
    expect(urls).not.toContain("https://example.com/mystery/feed");
    expect(urls).not.toContain("https://example.com/orphan/feed");
  });
});
