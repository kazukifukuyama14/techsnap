import { FEED_URLS } from "@/lib/feeds";
import { getSource } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const limit = Math.max(1, Math.min(50, +(searchParams.get("limit") || 30)));
    if (!slug) return Response.json({ items: [] }, { status: 400 });

    const source = getSource(slug);
    const urls = [...(FEED_URLS[slug] || []), ...(FEED_URLS[`${slug}_legacy`] || [])];
    const headers: Record<string, string> = {
      accept: "application/rss+xml, application/atom+xml, text/xml, */*",
      "accept-language": "en-US,en;q=0.8,ja;q=0.7",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers, cache: "no-store" });
        if (!r.ok) continue;
        const text = await r.text();
        // JSON Feed support
        if (/^\s*\{/.test(text)) {
          const items = parseJsonFeed(text, slug, source?.name || slug).slice(0, limit);
          if (items.length) return Response.json({ items });
        }
        // XML RSS/Atom
        const itemsXml = parseXmlServer(text, slug, source?.name || slug).slice(0, limit);
        if (itemsXml.length) return Response.json({ items: itemsXml });
        // Try discovery from HTML
        const discovered = discoverFeedLinks(text);
        for (const alt of discovered) {
          try {
            const r2 = await fetch(new URL(alt, url).toString(), { headers, cache: "no-store" });
            if (!r2.ok) continue;
            const t2 = await r2.text();
            if (/^\s*\{/.test(t2)) {
              const items = parseJsonFeed(t2, slug, source?.name || slug).slice(0, limit);
              if (items.length) return Response.json({ items });
            }
            const items2 = parseXmlServer(t2, slug, source?.name || slug).slice(0, limit);
            if (items2.length) return Response.json({ items: items2 });
          } catch {}
        }
      } catch {}
    }
    // Nuxt 特化の最終フォールバック: ブログ一覧HTMLからリンクを抽出
    if (slug === "nuxt") {
      try {
        const r = await fetch("https://nuxt.com/blog", { headers, cache: "no-store" });
        if (r.ok) {
          const html = await r.text();
          const items = parseHtmlIndex(html, slug, source?.name || slug).slice(0, limit);
          if (items.length) return Response.json({ items });
        }
      } catch {}
    }
    return Response.json({ items: [] }, { status: 200 });
  } catch (e: any) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

type Item = { id: string; title: string; url: string; publishedAt: string; sourceSlug: string; sourceName: string; kind: string; excerpt?: string };

function parseXmlServer(xml: string, sourceSlug: string, sourceName: string): Item[] {
  try {
    // crude detection
    if (/<feed[\s\S]*?<entry[\s>]/i.test(xml)) return parseAtom(xml, sourceSlug, sourceName);
    if (/<rss[\s\S]*?<item[\s>]/i.test(xml)) return parseRss(xml, sourceSlug, sourceName);
  } catch {}
  return [];
}

function parseAtom(xml: string, sourceSlug: string, sourceName: string): Item[] {
  const out: Item[] = [];
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
      kind: "blog",
      excerpt: limitExcerpt(stripHtml(decodeEntities(excerptRaw))),
    });
  }
  return out;
}

function parseRss(xml: string, sourceSlug: string, sourceName: string): Item[] {
  const out: Item[] = [];
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
      kind: "blog",
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
    return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  } catch { return s; }
}

function parseJsonFeed(jsonStr: string, sourceSlug: string, sourceName: string): Item[] {
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
        kind: "blog",
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

function parseHtmlIndex(html: string, sourceSlug: string, sourceName: string): Item[] {
  const out: Item[] = [];
  const seen = new Set<string>();
  const base = "https://nuxt.com";

  // 1) JSON-LD から BlogPosting を抽出
  const scripts = Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi));
  for (const m of scripts) {
    try {
      const json = JSON.parse(m[1]);
      const nodes = Array.isArray((json as any)?.["@graph"]) ? (json as any)["@graph"] : (Array.isArray(json) ? json : [json]);
      for (const n of nodes as any[]) {
        const typeRaw = Array.isArray((n as any)?.["@type"]) ? (n as any)["@type"][0] : (n as any)?.["@type"];
        const type = String(typeRaw || "").toLowerCase();
        if (type !== "blogposting" && type !== "article") continue;
        const title = String(n?.headline || n?.name || "").trim();
        let url = String(n?.url || n?.mainEntityOfPage || "").trim();
        if (!url) continue;
        if (!/^https?:/i.test(url)) url = new URL(url, base).toString();
        if (seen.has(url)) continue; seen.add(url);
        out.push({
          id: `${sourceSlug}-html-${out.length}-${url}`,
          title: stripHtml(excerptToText(title)) || "(no title)",
          url,
          publishedAt: new Date(n?.datePublished || Date.now()).toISOString(),
          sourceSlug,
          sourceName,
          kind: "blog",
          excerpt: limitExcerpt(stripHtml(String(n?.description || ""))),
        });
        if (out.length >= 30) break;
      }
      if (out.length >= 10) return out; // 十分取れたら返す
    } catch {}
  }

  // 2) aタグから /blog/ を抽出
  const aRe = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const tagRe = /<[^>]+>/g;
  let m2: RegExpExecArray | null;
  while ((m2 = aRe.exec(html))) {
    let href = m2[1];
    const text = String(m2[2] || "").replace(tagRe, " ").replace(/\s+/g, " ").trim();
    if (!text || text.length < 6) continue;
    if (!/\/blog\//.test(href)) continue;
    if (!/^https?:/i.test(href)) href = new URL(href, base).toString();
    if (seen.has(href)) continue; seen.add(href);
    out.push({
      id: `${sourceSlug}-html-${out.length}-${href}`,
      title: text,
      url: href,
      publishedAt: new Date().toISOString(),
      sourceSlug,
      sourceName,
      kind: "blog",
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
  return t.slice(0, max).replace(/[,.、。;:・\-\s]+\S*$/, "") + "…";
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
    // numeric entities
    .replace(/&#(x?[0-9A-Fa-f]+);/g, (_, code) => {
      try {
        const cp = String(code).toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      } catch { return _; }
    })
    // common named entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
