// OPML art-feed loader for the daily briefing dashboard (Bun, zero deps).
//
// arts-feeds.opml at the repo root is the single source of truth for the
// indie/underground art feeds. server.ts reads it at startup instead of
// carrying a hardcoded list, so adding a feed means editing the OPML,
// never server.ts.
//
// Only the four live groups are read — caricom, africa, easteurope,
// artdiy. Every other group, including the "proposed" group, is ignored,
// so proposed feeds can never leak onto the dashboard. Region and
// noFilter behavior is unchanged: the parser returns the same shape
// server.ts used to hardcode ({ source, url, noFilter? } per region),
// in OPML document order, and the geo filter in server.ts applies
// exactly as before.

export interface ArtFeed {
  source: string;
  url: string;
  noFilter?: boolean;
}

export type ArtFeeds = Record<string, ArtFeed[]>;

export const LIVE_GROUPS = ["caricom", "africa", "easteurope", "artdiy"];

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
    attrs[m[1]] = unescapeXml(m[2]);
  }
  return attrs;
}

/// Parse OPML text into per-region art feeds. Pure and side-effect free,
/// so it is unit-testable without a daemon or a file.
export function parseOpml(text: string): ArtFeeds {
  const feeds: ArtFeeds = {};
  for (const g of LIVE_GROUPS) feeds[g] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  // Scan outline tags only; everything else (xml decl, opml, head, body)
  // is skipped. Group outlines open a scope, feed outlines are
  // self-closing and carry xmlUrl.
  const tagRe = /<(\/?)outline\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    const [, closing, attrText, selfClosing] = m;
    if (closing) {
      stack.pop();
      continue;
    }
    const attrs = parseAttrs(attrText);
    if (attrs.xmlUrl) {
      const group = stack[stack.length - 1];
      if (group && LIVE_GROUPS.includes(group) && !seen.has(attrs.xmlUrl)) {
        seen.add(attrs.xmlUrl);
        const feed: ArtFeed = {
          source: attrs.text || attrs.title || attrs.xmlUrl,
          url: attrs.xmlUrl,
        };
        if (attrs.noFilter === "true") feed.noFilter = true;
        feeds[group].push(feed);
      }
      // A feed outline should be self-closing; if one ever isn't, its
      // children belong to the same group, so keep the scope open only
      // when it actually opened one (it didn't — feeds don't scope).
      continue;
    }
    if (!selfClosing) {
      stack.push(attrs.text || "");
    }
  }
  return feeds;
}

/// Read and parse an OPML file. On any failure (missing file, malformed
/// XML) logs loudly and returns empty groups — a visible outage, never
/// silently stale feeds.
export async function loadArtsFeeds(path: string): Promise<ArtFeeds> {
  const empty: ArtFeeds = {};
  for (const g of LIVE_GROUPS) empty[g] = [];
  try {
    const text = await Bun.file(path).text();
    const feeds = parseOpml(text);
    const total = LIVE_GROUPS.reduce((n, g) => n + feeds[g].length, 0);
    if (total === 0) {
      console.error(`arts-feeds.opml at ${path} parsed to zero live feeds; art tabs will be empty`);
    }
    return feeds;
  } catch (e) {
    console.error(`failed to load arts-feeds.opml from ${path}: ${e}; art tabs will be empty`);
    return empty;
  }
}
