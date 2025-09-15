import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { getFeedSourcesByGroup, getFeedUrls } from "@/lib/feeds";
import { getSource } from "@/lib/data";

export const dynamic = "force-dynamic";

async function fetchWithTimeout(url: string, ms: number, accept?: string, referer?: string, retries: number = 0) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const u = new URL(url);
    // domain-based default referer
    let defaultReferer = undefined as string | undefined;
    if (u.hostname.endsWith("hashicorp.com")) defaultReferer = "https://www.hashicorp.com/";
    if (u.hostname.endsWith("cloud.google.com")) defaultReferer = "https://cloud.google.com/blog/";
    // optional proxy for hashicorp
    const proxied = rewriteIfProxy(u);
    const res = await fetch(proxied, {
      signal: controller.signal,
      // 一部のサイトで UA が必要な場合があるため簡易的に設定
      headers: {
        // 可能な限り一般的なブラウザUAを付与
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: accept || "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "accept-language": "en-US,en;q=0.8,ja;q=0.6",
        referer: referer || defaultReferer || undefined,
      },
      cache: "no-store",
      next: { revalidate: 0 },
    } as RequestInit);
    const body = await res.text();
    if (res.status === 429 && retries > 0) {
      const ra = Number(res.headers.get("retry-after")) || 1;
      await delay(Math.min(ra, 3) * 1000 + Math.floor(Math.random() * 500));
      return fetchWithTimeout(url, ms, accept, referer, retries - 1);
    }
    return { ok: res.ok, status: res.status, url, body, contentType: res.headers.get("content-type") };
  } catch (e: any) {
    return { ok: false, status: 0, url, body: String(e?.message ?? e), contentType: null };
  } finally {
    clearTimeout(id);
  }
}

// シンプルなRSS/Atom発見（<link rel="alternate" type="application/rss+xml"> 等）
async function discoverFeedFromPage(pageUrl: string) {
  const r = await fetchWithTimeout(pageUrl, 10_000, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
  if (!r.ok || !r.body) return [] as string[];
  const html = r.body;
  const links: string[] = [];
  // link rel alternate
  const linkRe = /<link[^>]+rel=["']alternate["'][^>]*>/gi;
  const hrefRe = /href=["']([^"']+)["']/i;
  const typeRe = /type=["']([^"']+)["']/i;
  const base = new URL(pageUrl);
  const matches = html.match(linkRe) || [];
  for (const tag of matches) {
    const type = tag.match(typeRe)?.[1] || "";
    if (/rss|atom|xml/i.test(type)) {
      const href = tag.match(hrefRe)?.[1];
      if (href) {
        try {
          const u = new URL(href, base);
          links.push(u.toString());
        } catch {}
      }
    }
  }
  // フォールバック: 明示的に含まれそうなURLをざっくり抽出
  // .xml や .rss のほか、末尾が /rss (クエリ付) のパターンも拾う
  const urlRe = /href=["']([^"']+(?:\.(?:xml|rss)|\/rss)(?:\?[^"']*)?)["']/gi;
  let m;
  while ((m = urlRe.exec(html))) {
    try {
      links.push(new URL(m[1], base).toString());
    } catch {}
  }
  // 重複除去
  return Array.from(new Set(links));
}

function guessFeedUrls(siteUrl: string): string[] {
  const base = new URL(siteUrl);
  const candidates = new Set<string>();
  const add = (p: string) => {
    try {
      candidates.add(new URL(p, base).toString());
      // ?hl=en も試す（GCP系対策）
      const withHl = new URL(p, base);
      withHl.searchParams.set("hl", "en");
      candidates.add(withHl.toString());
    } catch {}
  };
  // 代表的なパス
  [
    "feed",
    "feed.xml",
    "rss",
    "rss.xml",
    "atom.xml",
    "index.xml",
    "feeds/rss",
    "feeds/atom",
  ].forEach((p) => add(p));
  // /blog が含まれない場合は blog/ 配下も試行
  if (!/\/blog\/?$/.test(base.pathname)) {
    [
      "blog/feed",
      "blog/feed.xml",
      "blog/rss",
      "blog/rss.xml",
      "blog/atom.xml",
      "blog/index.xml",
    ].forEach((p) => add(p));
  }
  return Array.from(candidates).slice(0, 12);
}

function rewriteIfProxy(u: URL): string {
  // HashiCorp専用プロキシ（環境変数に設定された場合のみ）
  if (u.hostname.endsWith("hashicorp.com")) {
    const proxy = process.env.HASHICORP_RSS_PROXY;
    if (proxy) {
      const base = proxy.replace(/\/?$/, "");
      // 形式: <proxy>?u=<encoded>
      return `${base}?u=${encodeURIComponent(u.toString())}`;
    }
  }
  return u.toString();
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

// ---------- Simple file cache ----------
const FEEDS_TTL = Number(process.env.FEEDS_TTL_SECONDS || 900); // seconds
const FEEDS_CACHE_DIR = ".next/cache/feeds";

function cacheKeyFor(group?: string | null, source?: string | null) {
  if (source) return `source-${source}`;
  if (group) return `group-${group}`;
  return "all";
}

async function readCache(key: string): Promise<any | null> {
  try {
    const file = path.join(process.cwd(), FEEDS_CACHE_DIR, `${key}.json`);
    const stat = await fs.stat(file);
    const ageSec = (Date.now() - stat.mtimeMs) / 1000;
    if (ageSec > FEEDS_TTL) return null;
    const data = await fs.readFile(file, "utf8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: any) {
  try {
    const dir = path.join(process.cwd(), FEEDS_CACHE_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${key}.json`);
    await fs.writeFile(file, JSON.stringify(data), "utf8");
  } catch {}
}

function jsonHeaders() {
  return { "content-type": "application/json", "cache-control": "no-store" } as Record<string, string>;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const group = searchParams.get("group") as any | undefined;
  const sourceSlug = searchParams.get("source") ?? undefined;
  const debug = searchParams.get("debug") === "1";
  const fresh = searchParams.get("fresh") === "1";

  const cacheKey = cacheKeyFor(group, sourceSlug);
  if (!fresh) {
    const cached = await readCache(cacheKey);
    if (cached) return new Response(JSON.stringify(cached), { status: 200, headers: jsonHeaders() });
  }

  const targets = sourceSlug
    ? [getSource(sourceSlug)].filter(Boolean)
    : getFeedSourcesByGroup(group);

  const results: any[] = [];
  for (const s of targets) {
    let urls = getFeedUrls(s!.slug);
    const tried: any[] = [];
    let fetched: any = null;
    for (const u of urls) {
      const r = await fetchWithTimeout(u, 12_000, undefined, s!.siteUrl, u.includes("hashicorp.com") ? 2 : 0);
      if (debug) tried.push({ step: "feed", url: u, ok: r.ok, status: r.status, ct: r.contentType });
      if (r.ok && r.body) {
        const ct = (r.contentType || "").toLowerCase();
        const isXml = ct.includes("xml") || /<(rss|feed)[\s>]/i.test(r.body);
        if (isXml) {
          fetched = { ...r, sourceSlug: s!.slug, sourceName: s!.name };
          break;
        }
        // HTMLなどは無効として次候補へ
      }
    }
    // 失敗時: HTML からRSS/Atomを発見して再試行
    if (!fetched) {
      const discovered = await discoverFeedFromPage(s!.siteUrl!);
      if (debug) tried.push({ step: "discover", site: s!.siteUrl, candidates: discovered });
      if (discovered.length) {
        urls = discovered.slice(0, 3);
        for (const du of urls) {
          const r2 = await fetchWithTimeout(du, 12_000, undefined, s!.siteUrl, du.includes("hashicorp.com") ? 2 : 0);
          if (debug) tried.push({ step: "discover-fetch", url: du, ok: r2.ok, status: r2.status, ct: r2.contentType });
          if (r2.ok && r2.body) {
            fetched = { ...r2, sourceSlug: s!.slug, sourceName: s!.name };
            break;
          }
        }
      }
    }
    // ドメイン専用抽出（最後の最後のフォールバック）
    if (!fetched) {
      const spec = await domainSpecificExtract(s!.slug, s!.siteUrl!);
      if (spec && spec.items.length) {
        fetched = {
          ok: true,
          status: 200,
          url: s!.siteUrl,
          contentType: "text/html",
          format: "html-json",
          sourceSlug: s!.slug,
          sourceName: s!.name,
          items: spec.items,
        };
      }
    }
    // さらに失敗時: ヒューリスティックに推測
    if (!fetched) {
      const guessed = guessFeedUrls(s!.siteUrl!);
      if (debug) tried.push({ step: "guess", site: s!.siteUrl, candidates: guessed });
      for (const gu of guessed) {
        const r3 = await fetchWithTimeout(gu, 12_000, undefined, s!.siteUrl, gu.includes("hashicorp.com") ? 2 : 0);
        if (debug) tried.push({ step: "guess-fetch", url: gu, ok: r3.ok, status: r3.status, ct: r3.contentType });
        if (r3.ok && r3.body) {
          fetched = { ...r3, sourceSlug: s!.slug, sourceName: s!.name };
          break;
        }
      }
    }
    // Google Cloud / HashiCorp(Terraform) の最終フォールバック: HTMLから一覧を簡易抽出
    if (!fetched) {
      try {
        const htmlRes = await fetchWithTimeout(s!.siteUrl!, 12_000, "text/html,application/xhtml+xml");
        if (htmlRes.ok && htmlRes.body) {
          const items = scrapeListFromHtml(htmlRes.body, s!.siteUrl!);
          if (items.length) {
            fetched = {
              ok: true,
              status: 200,
              url: s!.siteUrl,
              contentType: "text/html",
              format: "html-json",
              sourceSlug: s!.slug,
              sourceName: s!.name,
              items,
            };
          }
        }
      } catch {}
    }
    // 依然失敗なら最後のレスポンス（またはnull）を記録
    if (!fetched) {
      fetched = { ok: false, status: 0, url: urls[urls.length - 1] ?? s!.siteUrl, body: "", contentType: null, sourceSlug: s!.slug, sourceName: s!.name };
    }
    if (debug) fetched.tried = tried;
    if (fetched) results.push(fetched);
  }

  const payload = { results, cachedAt: new Date().toISOString() };
  await writeCache(cacheKey, payload);
  return new Response(JSON.stringify(payload), { status: 200, headers: jsonHeaders() });
}

// とても簡易な一覧抽出: a要素から /blog を含む（同一ドメイン）リンクを拾ってタイトルと日付らしきテキストを抜く
function scrapeListFromHtml(html: string, siteUrl: string) {
  // 最小の正規表現で aタグ を収集
  const base = new URL(siteUrl);
  const aTagRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const titleRe = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i;
  const timeRe = /<time[^>]*>([\s\S]*?)<\/time>/i;
  const stripRe = /<[^>]+>/g;
  const items: { title: string; url: string; publishedAt?: string; excerpt?: string }[] = [];
  let m: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((m = aTagRe.exec(html))) {
    const hrefRaw = m[1];
    // 同一ドメインの /blog… のみ対象
    try {
      const u = new URL(hrefRaw, base);
      if (u.hostname !== base.hostname) continue;
      if (!/\/blog\//.test(u.pathname)) continue;
      const href = u.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      const inner = m[2] || "";
      const h = inner.match(titleRe)?.[1] || inner;
      const title = (h || "").replace(stripRe, "").trim();
      if (!title) continue;
      const t = inner.match(timeRe)?.[1];
      const publishedAt = t ? new Date(t.replace(stripRe, "").trim()).toISOString() : undefined;
      items.push({ title, url: href, publishedAt });
      if (items.length >= 30) break;
    } catch {}
  }
  return items;
}

async function domainSpecificExtract(slug: string, siteUrl: string) {
  try {
    const host = new URL(siteUrl).hostname;
    if (slug === "gcp" && host.includes("cloud.google.com")) {
      // 言語問わず一覧ページを試す
      const pages = [
        "https://cloud.google.com/blog/?hl=en",
        "https://cloud.google.com/blog/ja?hl=ja",
      ];
      for (const p of pages) {
        const r = await fetchWithTimeout(p, 12_000, "text/html");
        if (r.ok && r.body) {
          const jsonld = extractJsonLdArticles(r.body, p);
          const items = jsonld.length ? jsonld : scrapeListFromHtml(r.body, p);
          if (items.length) return { items };
        }
      }
    }
    if (slug === "terraform" && host.includes("hashicorp.com")) {
      const pages = [
        "https://www.hashicorp.com/blog",
        "https://www.hashicorp.com/blog/tag/terraform",
        "https://www.hashicorp.com/ja/blog",
        "https://www.hashicorp.com/ja/blog/tag/terraform",
      ];
      for (const p of pages) {
        const r = await fetchWithTimeout(p, 12_000, "text/html");
        if (r.ok && r.body) {
          // JSON-LD を優先、その後にカード抽出
          const jsonld = extractJsonLdArticles(r.body, p);
          const items = jsonld.length ? jsonld : extractHashicorp(r.body, p);
          if (items.length) return { items };
        }
      }
    }
  } catch {}
  return null;
}

function extractHashicorp(html: string, baseUrl: string) {
  const base = new URL(baseUrl);
  const items: { title: string; url: string; publishedAt?: string }[] = [];
  const aRe = /<a\b[^>]*href=["']([^"']+\/blog\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const timeNearRe = /<time[^>]*datetime=["']([^"']+)["'][^>]*>/i;
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = aRe.exec(html))) {
    try {
      const href = new URL(m[1], base).toString();
      if (seen.has(href)) continue;
      seen.add(href);
      // タイトル候補
      const inner = m[2] || "";
      const title = strip(inner) || href;
      // 近接テキストから <time datetime> を探す（アンカーの後方500文字以内）
      const tail = html.slice(m.index, Math.min(html.length, m.index + 800));
      const timeMatch = tail.match(timeNearRe);
      const publishedAt = timeMatch ? new Date(timeMatch[1]).toISOString() : undefined;
      items.push({ title, url: href, publishedAt });
      if (items.length >= 40) break;
    } catch {}
  }
  return items;
}

function extractJsonLdArticles(html: string, baseUrl: string) {
  const base = new URL(baseUrl);
  const strip = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const out: { title: string; url: string; publishedAt?: string }[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1];
    try {
      const json = JSON.parse(raw);
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        if (!node) continue;
        const entries = Array.isArray(node) ? node : [node];
        for (const e of entries) {
          if (!e) continue;
          if (e["@type"] === "BlogPosting" || e["@type"] === "NewsArticle") {
            const title = e.headline || e.name || e.title || "";
            const u = e.url || e["mainEntityOfPage"]; // may be URL string
            const url = u ? new URL(u, base).toString() : undefined;
            const publishedAt = e.datePublished || e.dateCreated || e.dateModified;
            if (title && url) out.push({ title: strip(String(title)), url, publishedAt });
          }
          // Graph形式
          if (e["@graph"]) {
            for (const g of e["@graph"]) {
              if (g && (g["@type"] === "BlogPosting" || g["@type"] === "NewsArticle")) {
                const title = g.headline || g.name || g.title || "";
                const u = g.url || g["mainEntityOfPage"]; // may be URL string
                const url = u ? new URL(u, base).toString() : undefined;
                const publishedAt = g.datePublished || g.dateCreated || g.dateModified;
                if (title && url) out.push({ title: strip(String(title)), url, publishedAt });
              }
            }
          }
        }
      }
    } catch {}
  }
  return dedupeBy(out, (x) => x.url).slice(0, 40);
}

function dedupeBy<T>(arr: T[], key: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of arr) {
    const k = key(it);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}
