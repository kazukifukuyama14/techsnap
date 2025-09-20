import { FEED_URLS } from "@/lib/feeds";
import { getSource } from "@/lib/data";
import { FeedItem, FeedKind, GroupKey } from "@/lib/types";
import { getFirestoreAdmin, getFirestoreInitError } from "@/lib/server/firestore";
import {
  computeExpiry,
  getDateKey,
  isFresh,
  readFeedCache,
  updateFeedCacheMeta,
  writeFeedCache,
} from "@/lib/server/feedCache";

export const dynamic = "force-dynamic";

const BASE_HEADERS: Record<string, string> = {
  accept: "application/rss+xml, application/atom+xml, text/xml, */*",
  "accept-language": "en-US,en;q=0.8,ja;q=0.7",
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const limit = Math.max(1, Math.min(50, +(searchParams.get("limit") || 30)));
    const refresh = searchParams.get("refresh") === "1";
    if (!slug) return Response.json({ items: [] }, { status: 400 });

    const source = getSource(slug);
    const now = new Date();
    const dateKey = getDateKey(now);
    const db = getFirestoreAdmin();
    const cached = db ? await readFeedCache(db, slug, dateKey) : null;
    const cacheFresh = cached ? isFresh(cached, now) : false;

    if (cached && cacheFresh && !refresh) {
      return Response.json({ items: cached.items.slice(0, limit), cache: "hit", fetchedAt: cached.fetchedAt });
    }

    const conditional = !refresh && cached ? { etag: cached.etag, lastModified: cached.lastModified, endpoint: cached.endpoint } : {};

    const fetchResult = await fetchRemoteFeed({
      slug,
      sourceName: source?.name || slug,
      sourceGroup: source?.group,
      limit,
      conditional,
    });

    if (fetchResult?.status === "not-modified" && cached) {
      if (db) {
        await updateFeedCacheMeta(db, slug, dateKey, {
          fetchedAt: now.toISOString(),
          expiresAt: computeExpiry(now),
        });
      }
      return Response.json({ items: cached.items.slice(0, limit), cache: "hit", fetchedAt: now.toISOString() });
    }

    if (fetchResult?.status === "ok" && fetchResult.items) {
      const payload = {
        items: fetchResult.items,
        fetchedAt: now.toISOString(),
        expiresAt: computeExpiry(now),
        etag: fetchResult.etag ?? undefined,
        lastModified: fetchResult.lastModified ?? undefined,
        endpoint: fetchResult.endpoint,
      } as const;
      if (db) {
        await writeFeedCache(db, slug, dateKey, payload);
      }
      return Response.json({ items: fetchResult.items.slice(0, limit), cache: cached ? "refresh" : "miss", fetchedAt: now.toISOString() });
    }

    if (cached) {
      return Response.json({ items: cached.items.slice(0, limit), cache: "stale", fetchedAt: cached.fetchedAt });
    }

    return Response.json({ items: [] }, { status: 200 });
  } catch (e: any) {
    console.error("/api/feeds error", e);
    console.error("stack:", e?.stack);
    const initError = getFirestoreInitError();
    return Response.json({
      error: typeof e === "object" && e ? { message: String(e.message || e), code: (e as any)?.code } : String(e ?? "Unknown error"),
      firestoreInitError: initError ? String(initError.message || initError) : undefined,
    }, { status: 500 });
  }
}

type FetchResult =
  | { status: "ok"; items: FeedItem[]; etag?: string | null; lastModified?: string | null; endpoint?: string }
  | { status: "not-modified" }
  | { status: "error" };

type ConditionalHeaders = { etag?: string | null; lastModified?: string | null; endpoint?: string | null };

async function fetchRemoteFeed(opts: {
  slug: string;
  sourceName: string;
  sourceGroup?: GroupKey;
  limit: number;
  conditional?: ConditionalHeaders;
}): Promise<FetchResult | null> {
  const urlsRaw = FEED_URLS[opts.slug] || [];
  const legacy = FEED_URLS[`${opts.slug}_legacy`] || [];
  const candidates = Array.from(new Set([...urlsRaw, ...legacy]));
  const ordered = prioritizeEndpoint(candidates, opts.conditional?.endpoint);
  const headersBase = { ...BASE_HEADERS };

  let etagOut: string | null | undefined;
  let lastModifiedOut: string | null | undefined;
  let usedEndpoint: string | undefined;

  for (let index = 0; index < ordered.length; index++) {
    const url = ordered[index];
    const headers = { ...headersBase };
    if (index === 0 && opts.conditional?.etag) headers["if-none-match"] = opts.conditional.etag;
    if (index === 0 && opts.conditional?.lastModified) headers["if-modified-since"] = opts.conditional.lastModified;

    try {
      const r = await fetch(url, { headers, cache: "no-store" });
      if (r.status === 304) {
        return { status: "not-modified" };
      }
      if (!r.ok) continue;
      const etag = r.headers.get("etag");
      const lastModified = r.headers.get("last-modified");
      etagOut = etag;
      lastModifiedOut = lastModified;
      usedEndpoint = url;

      const text = await r.text();
      if (/^\s*\{/.test(text)) {
        const items = attachGroup(parseJsonFeed(text, opts.slug, opts.sourceName).slice(0, opts.limit), opts.sourceGroup);
        if (items.length) return { status: "ok", items, etag: etagOut, lastModified: lastModifiedOut, endpoint: usedEndpoint };
      }
      const itemsXml = attachGroup(parseXmlServer(text, opts.slug, opts.sourceName).slice(0, opts.limit), opts.sourceGroup);
      if (itemsXml.length) return { status: "ok", items: itemsXml, etag: etagOut, lastModified: lastModifiedOut, endpoint: usedEndpoint };
      const discovered = discoverFeedLinks(text);
      for (const alt of discovered) {
        try {
          const headersAlt = { ...headersBase };
          const r2 = await fetch(new URL(alt, url).toString(), { headers: headersAlt, cache: "no-store" });
          if (!r2.ok) continue;
          const etag2 = r2.headers.get("etag");
          const lastModified2 = r2.headers.get("last-modified");
          etagOut = etag2 || etagOut;
          lastModifiedOut = lastModified2 || lastModifiedOut;
          usedEndpoint = new URL(alt, url).toString();

          const t2 = await r2.text();
          if (/^\s*\{/.test(t2)) {
            const items = attachGroup(parseJsonFeed(t2, opts.slug, opts.sourceName).slice(0, opts.limit), opts.sourceGroup);
            if (items.length) return { status: "ok", items, etag: etagOut, lastModified: lastModifiedOut, endpoint: usedEndpoint };
          }
          const items2 = attachGroup(parseXmlServer(t2, opts.slug, opts.sourceName).slice(0, opts.limit), opts.sourceGroup);
          if (items2.length) return { status: "ok", items: items2, etag: etagOut, lastModified: lastModifiedOut, endpoint: usedEndpoint };
        } catch {}
      }
    } catch {}
  }

  if (opts.slug === "nuxt") {
    try {
      const r = await fetch("https://nuxt.com/blog", { headers: headersBase, cache: "no-store" });
      if (r.status === 304) return { status: "not-modified" };
      if (r.ok) {
        const html = await r.text();
        const items = attachGroup(parseHtmlIndex(html, opts.slug, opts.sourceName).slice(0, opts.limit), opts.sourceGroup);
        if (items.length) return { status: "ok", items, endpoint: "https://nuxt.com/blog" };
      }
    } catch {}
  }

  return { status: "error" };
}

function prioritizeEndpoint(urls: string[], endpoint?: string | null) {
  if (!endpoint) return urls;
  const set = new Set(urls);
  const ordered: string[] = [];
  if (set.has(endpoint)) {
    ordered.push(endpoint);
    set.delete(endpoint);
  }
  for (const url of urls) {
    if (set.has(url)) {
      ordered.push(url);
      set.delete(url);
    }
  }
  return ordered.length ? ordered : urls;
}

function attachGroup(items: FeedItem[], group?: GroupKey) {
  if (!group) return items;
  return items.map((it) => (it.group ? it : { ...it, group }));
}

function parseXmlServer(xml: string, sourceSlug: string, sourceName: string): FeedItem[] {
  try {
    if (/<feed[\s\S]*?<entry[\s>]/i.test(xml)) return parseAtom(xml, sourceSlug, sourceName);
    if (/<rss[\s\S]*?<item[\s>]/i.test(xml)) return parseRss(xml, sourceSlug, sourceName);
  } catch {}
  return [];
}

function parseAtom(xml: string, sourceSlug: string, sourceName: string): FeedItem[] {
  const out: FeedItem[] = [];
  const entryRe = /<entry[\s\S]*?<\/entry>/gi;
  const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const linkRe = /<link[^>]*?href=["']([^"']+)["'][^>]*>/i;
  const updatedRe = /<updated[^>]*>([\s\S]*?)<\/updated>/i;
  const summaryRe = /<summary[^>]*>([\s\S]*?)<\/summary>/i;
  const contentRe = /<content[^>]*>([\s\S]*?)<\/content>/i;
  const entries = xml.match(entryRe) || [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const title = (e.match(titleRe)?.[1] || "").trim();
    const href = e.match(linkRe)?.[1] || "#";
    const publishedRaw = (e.match(updatedRe)?.[1] || "").trim();
    const published = toIsoOrEmpty(publishedRaw);
    const excerptRaw = (e.match(summaryRe)?.[1] || e.match(contentRe)?.[1] || "").trim();
    out.push({
      id: `${sourceSlug}-atom-${i}-${href}`,
      title: stripHtml(excerptToText(title)) || "(no title)",
      url: href,
      publishedAt: published || "1970-01-01T00:00:00.000Z",
      sourceSlug,
      sourceName,
      kind: "blog" as FeedKind,
      excerpt: limitExcerpt(stripHtml(decodeEntities(excerptRaw))),
    });
  }
  return out;
}

function parseRss(xml: string, sourceSlug: string, sourceName: string): FeedItem[] {
  const out: FeedItem[] = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title[^>]*>([\s\S]*?)<\/title>/i;
  const linkRe = /<link[^>]*>([\s\S]*?)<\/link>/i;
  const linkHrefRe = /<link[^>]*?href=["']([^"']+)["'][^>]*>/i;
  const pubDateRe = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i;
  const descRe = /<description[^>]*>([\s\S]*?)<\/description>/i;
  const contentRe = /<content:encoded[^>]*>([\s\S]*?)<\/content:encoded>/i;
  const items = xml.match(itemRe) || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const title = (it.match(titleRe)?.[1] || "").trim();
    const link = (it.match(linkRe)?.[1] || it.match(linkHrefRe)?.[1] || "").trim();
    const pubRaw = (it.match(pubDateRe)?.[1] || "").trim();
    const pub = toIsoOrEmpty(pubRaw);
    const desc = (it.match(descRe)?.[1] || it.match(contentRe)?.[1] || "").trim();
    out.push({
      id: `${sourceSlug}-rss-${i}-${link}`,
      title: stripHtml(excerptToText(title)) || "(no title)",
      url: link || "#",
      publishedAt: pub || "1970-01-01T00:00:00.000Z",
      sourceSlug,
      sourceName,
      kind: "blog" as FeedKind,
      excerpt: limitExcerpt(stripHtml(decodeEntities(desc))),
    });
  }
  return out;
}

function stripHtml(html: string) {
  return (html || "")
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function excerptToText(s: string) {
  try {
    return s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  } catch {
    return s;
  }
}

function parseJsonFeed(jsonStr: string, sourceSlug: string, sourceName: string): FeedItem[] {
  try {
    const data = JSON.parse(jsonStr);
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.slice(0, 60).map((it: any, idx: number) => {
      const when = toIsoOrEmpty(String(it.date_published || it.published || it.published_at || ""));
      return {
        id: `${sourceSlug}-json-${idx}-${it.id || it.url || it.external_url || idx}`,
        title: stripHtml(excerptToText(String(it.title || "(no title)"))),
        url: String(it.url || it.external_url || "#"),
        publishedAt: when || "1970-01-01T00:00:00.000Z",
        sourceSlug,
        sourceName,
        kind: "blog" as FeedKind,
        excerpt: limitExcerpt(stripHtml(decodeEntities(String(it.summary || it.content_text || it.content_html || "")))),
      };
    });
  } catch {
    return [];
  }
}

function discoverFeedLinks(html: string): string[] {
  const out = new Set<string>();
  const linkRe = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;
  const typeRe = /type=["']([^"']+)["']/i;
  const links = html.match(linkRe) || [];
  for (const l of links) {
    const href = l.match(hrefRe)?.[1];
    const type = (l.match(typeRe)?.[1] || "").toLowerCase();
    if (!href) continue;
    if (/(rss|atom|xml|application\/rss\+xml|application\/atom\+xml|application\/feed\+json)/.test(type) || /\/feed|\.xml|rss/.test(href)) {
      out.add(href);
    }
  }
  return Array.from(out);
}

function parseHtmlIndex(html: string, sourceSlug: string, sourceName: string): FeedItem[] {
  const out: FeedItem[] = [];
  const seen = new Set<string>();
  const base = "https://nuxt.com";

  const scripts = Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi));
  for (const m of scripts) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray((json as any)?.["@graph"]) ? (json as any)["@graph"] : Array.isArray(json) ? json : [json];
      for (const n of nodes as any[]) {
        const typeRaw = Array.isArray((n as any)?.["@type"]) ? (n as any)["@type"][0] : (n as any)?.["@type"];
        const type = String(typeRaw || "").toLowerCase();
        if (type !== "blogposting" && type !== "article") continue;
        const title = String(n?.headline || n?.name || "").trim();
        let url = String(n?.url || n?.mainEntityOfPage || "").trim();
        if (!url) continue;
        if (!/^https?:/i.test(url)) url = new URL(url, base).toString();
        if (seen.has(url)) continue;
        seen.add(url);
        out.push({
          id: `${sourceSlug}-html-${out.length}-${url}`,
          title: stripHtml(excerptToText(title)) || "(no title)",
          url,
          publishedAt: new Date(n?.datePublished || Date.now()).toISOString(),
          sourceSlug,
          sourceName,
          kind: "blog" as FeedKind,
          excerpt: limitExcerpt(stripHtml(String(n?.description || ""))),
        });
        if (out.length >= 30) break;
      }
      if (out.length >= 10) return out;
    } catch {}
  }

  const aRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const tagRe = /<[^>]+>/g;
  let m2: RegExpExecArray | null;
  while ((m2 = aRe.exec(html))) {
    let href = m2[1];
    const text = String(m2[2] || "").replace(tagRe, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 6) continue;
    if (!/\/blog\//.test(href)) continue;
    if (!/^https?:/i.test(href)) href = new URL(href, base).toString();
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({
      id: `${sourceSlug}-html-${out.length}-${href}`,
      title: text,
      url: href,
      publishedAt: new Date().toISOString(),
      sourceSlug,
      sourceName,
      kind: "blog" as FeedKind,
      excerpt: "",
    });
    if (out.length >= 30) break;
  }
  return out;
}

function limitExcerpt(s: string, max = 260) {
  if (!s) return s;
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/[,.、。;:\-\s]+\S*$/, "") + "…";
}

function toIsoOrEmpty(s: string): string {
  if (!s) return "";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return d.toISOString();
}

function decodeEntities(s: string) {
  if (!s) return s;
  return s
    .replace(/&#(x?[0-9A-Fa-f]+);/g, (_, code) => {
      try {
        const cp = String(code).toLowerCase().startsWith("x") ? parseInt(code.slice(1), 16) : parseInt(code, 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      } catch {
        return _;
      }
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
