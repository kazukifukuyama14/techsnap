import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Item = { id: string; title: string; url: string; excerpt?: string };

type CachedEnrich = {
  summaryEn?: string;
  summaryJa?: string;
  descriptionJa?: string;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  if (!items.length) return Response.json({ items: [] });

  const FAST = process.env.ENRICH_FAST === "1";

  const cached = await readEnrichCache(items.map((i) => i.id));
  if (items.every((i) => cached[i.id]?.summaryJa)) {
    const out = items.map((i) => ({ id: i.id, ...cached[i.id] }));
    return Response.json({ items: out, provider: "cache" });
  }

  const htmls = FAST
    ? items.map((it) => ({ id: it.id, html: null as string | null }))
    : await runWithLimit(
        4,
        items.map((it) => async () => {
          try {
            const html = it.url ? await fetchArticleHtml(it.url) : null;
            return { id: it.id, html };
          } catch {
            return { id: it.id, html: null as string | null };
          }
        })
      );

  const contexts: Record<string, string> = {};
  for (const { id, html } of htmls) {
    if (!html) continue;
    const bodyFromDom = extractMainText(html);
    const bodyFromJsonLd = extractArticleBodyFromJsonLd(html);
    const chosen = bodyFromJsonLd.length > bodyFromDom.length ? bodyFromJsonLd : bodyFromDom;
    contexts[id] = decodeEntities(chosen).slice(0, 6000);
  }

  const openAiKey = process.env.OPENAI_API_KEY;
  const englishById = openAiKey
    ? await summarizeWithOpenAI(items, contexts, FAST, openAiKey)
    : {};

  const englishSummaries = items.map((it) => {
    const fromModel = clampEnglishSummary(cleanEnglishSummary(englishById[it.id]));
    if (fromModel) return fromModel;
    const fallback = pickKeySentence(contexts[it.id] || sanitizeForModel(it.excerpt || ""), it.title);
    return clampEnglishSummary(cleanEnglishSummary(fallback || it.excerpt || it.title));
  });

  const summaryJaList = await translateSummaries(englishSummaries);

  const out = items.map((it, idx) => ({
    id: it.id,
    summaryEn: englishSummaries[idx],
    summaryJa: summaryJaList[idx] || englishSummaries[idx],
    descriptionJa: summaryJaList[idx] || englishSummaries[idx],
  }));

  const map: Record<string, CachedEnrich> = {};
  for (const o of out) map[o.id] = o;
  await writeEnrichCache(map);

  return Response.json({ items: out, provider: openAiKey ? "openai" : "fallback" });
}

async function summarizeWithOpenAI(
  items: Item[],
  contexts: Record<string, string>,
  FAST: boolean,
  key: string
) {
  if (!items.length) return {} as Record<string, string>;

  const shaped = items.map((it) => ({
    id: it.id,
    title: sanitizeForModel(it.title || ""),
    excerpt: sanitizeForModel(decodeEntities((it.excerpt && it.excerpt.trim()) ? it.excerpt : it.title)).slice(0, FAST ? 300 : 800),
    content: FAST ? "" : sanitizeForModel(contexts[it.id] || "").slice(0, 3200),
  }));

  const system = [
    "You are a senior technical editor.",
    "For each item, write a single English sentence (max 26 words) that captures the key update.",
    "Do not mention vague phrases like 'the article discusses'. Focus on concrete releases, fixes, or announcements.",
    "Return JSON strictly in the following shape: {\"items\": {\"<id>\": {\"summaryEn\": \"...\"}}}.",
    "Plain text only, no markdown, quotes, URLs, or emojis.",
  ].join("\n");

  const user = [
    "Items:",
    JSON.stringify(shaped),
  ].join("\n");

  const bodyReq = {
    model: process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  } as any;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FAST ? 12000 : 20000);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(bodyReq),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const data = await res.json();
    const parsed = safeParseJsonObject(data?.choices?.[0]?.message?.content || "");
    const result: Record<string, string> = {};
    for (const it of items) {
      const summary = parsed?.items?.[it.id]?.summaryEn ?? parsed?.items?.[it.id]?.summary ?? "";
      result[it.id] = cleanEnglishSummary(summary);
    }
    return result;
  } catch {
    clearTimeout(timer);
    return {} as Record<string, string>;
  }
}

async function translateSummaries(english: string[]) {
  if (!english.length) return [] as string[];
  if (process.env.DEEPL_API_KEY) {
    const deepL = await translateToJaDeepL(english);
    if (deepL?.length === english.length) {
      return deepL.map((t: string, idx: number) => clampJapaneseSummary(cleanSummary(t || english[idx])));
    }
  }
  const openai = await translateToJa(english);
  if (openai?.length === english.length) {
    return openai.map((t: string, idx: number) => clampJapaneseSummary(cleanSummary(t || english[idx])));
  }
  return english.map((t) => clampJapaneseSummary(t));
}

async function runWithLimit<T>(limit: number, tasks: (() => Promise<T>)[]) {
  const results: T[] = [];
  let i = 0;
  const workers = new Array(limit).fill(0).map(async () => {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchArticleHtml(url: string) {
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  };
  const r = await fetch(url, { headers, cache: "no-store" });
  return await r.text();
}

function extractMainText(html: string) {
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const article = articleMatch?.[0] || "";
  const articleText = stripHtml(article);
  if (articleText && articleText.length > 800) return articleText;

  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  const pMatches = cleaned.match(/<p[\s\S]*?<\/p>/gi) || [];
  const scored = pMatches.map((p) => {
    const t = stripHtml(p);
    const score = t.length + (/[\.!?。！？]/.test(t) ? 40 : 0);
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 14).map((x) => x.t).join("\n");
  return top || stripHtml(html);
}

function extractArticleBodyFromJsonLd(html: string) {
  const scripts = Array.from(html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi));
  for (const m of scripts) {
    try {
      const json: any = JSON.parse(m[1]);
      const graph = Array.isArray(json?.["@graph"]) ? (json as any)["@graph"] : [json];
      for (const g of graph) {
        const body = g?.articleBody || g?.description;
        if (typeof body === "string" && body.length > 200) return body as string;
      }
    } catch {}
  }
  return "";
}

function stripHtml(html: string) {
  if (!html) return html;
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[\.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function pickKeySentence(text: string, title?: string): string | null {
  if (!text) return title || null;
  const sentences = splitIntoSentences(text);
  if (!sentences.length) return title || null;
  const keywords = title ? title.split(/\s+/).slice(0, 2).join(" ") : "";
  let best = sentences[0];
  let bestScore = -Infinity;
  sentences.forEach((s, idx) => {
    let score = 0;
    const len = s.length;
    if (len >= 40 && len <= 220) score += 3;
    if (/[0-9]+\.[0-9]+/.test(s)) score += 2;
    if (/(release|launch|update|fix|patch)/i.test(s)) score += 2;
    if (keywords && new RegExp(keywords, "i").test(s)) score += 1;
    if (idx <= 1) score += 1;
    if (/subscribe|cookie|share/i.test(s)) score -= 5;
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  });
  return best;
}

function sanitizeForModel(s: string) {
  return (s || "")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function cleanEnglishSummary(s?: string) {
  if (!s) return "";
  return decodeEntities(s)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, "")
    .trim();
}

function cleanSummary(s?: string) {
  if (!s) return s;
  return decodeEntities(s)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*…+\s*$/g, "。")
    .trim();
}

function clampEnglishSummary(s?: string) {
  if (!s) return "";
  let text = s.trim();
  if (!text) return "";
  const words = text.split(/\s+/);
  if (words.length > 26) text = words.slice(0, 26).join(" ");
  if (text.length > 200) text = text.slice(0, 200).trim();
  return text;
}

function clampJapaneseSummary(s?: string) {
  if (!s) return "";
  let text = s.trim();
  if (!text) return "";
  const MAX_CHARS = 140;
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS).replace(/[、。.!?！？\s]+$/, "");
  }
  if (!/[。.!?！？]$/.test(text)) text = `${text}。`;
  return text;
}

async function translateToJa(list: string[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return list;
  const sys = 'You translate to Japanese. Return JSON with {"items": ["..."]}. Each item is one sentence (90-120 chars), no URLs/emojis/markdown.';
  const usr = JSON.stringify({ items: list });
  const body = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: usr },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  } as any;
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) return list;
  const data = await r.json();
  try {
    const content = data?.choices?.[0]?.message?.content || "";
    const obj = safeParseJsonObject(content);
    const arr = Array.isArray(obj?.items) ? obj.items : [];
    return arr.map((x: any) => String(x || ""));
  } catch {
    return list;
  }
}

async function translateToJaDeepL(list: string[]): Promise<string[]> {
  const key = process.env.DEEPL_API_KEY;
  if (!key) return list;
  const endpoint = process.env.DEEPL_API_URL || "https://api-free.deepl.com/v2/translate";
  const params: string[] = [];
  for (const t of list) params.push(`text=${encodeURIComponent(t || "")}`);
  params.push("target_lang=JA");
  const body = params.join("&");
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      Authorization: `DeepL-Auth-Key ${key}`,
    },
    body,
  });
  if (!r.ok) return list;
  try {
    const data = await r.json();
    const trans = Array.isArray(data?.translations) ? data.translations : [];
    return trans.map((x: any) => String(x?.text || ""));
  } catch {
    return list;
  }
}

function safeParseJsonObject(s: string): any {
  try { return JSON.parse(s); } catch {}
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  const a = s.match(/\[[\s\S]*\]/);
  if (a) { try { return { items: JSON.parse(a[0]) }; } catch {} }
  return {};
}

async function readEnrichCache(ids: string[]) {
  try {
    const f = path.join(process.cwd(), ".next", "cache", "enrich.json");
    const txt = await fs.readFile(f, "utf8").catch(() => "{}");
    const data = JSON.parse(txt || "{}");
    const out: Record<string, CachedEnrich> = {};
    for (const id of ids) if (data[id]) out[id] = data[id];
    return out;
  } catch {
    return {} as Record<string, CachedEnrich>;
  }
}

async function writeEnrichCache(map: Record<string, CachedEnrich>) {
  try {
    const f = path.join(process.cwd(), ".next", "cache", "enrich.json");
    await fs.mkdir(path.dirname(f), { recursive: true });
    let base: Record<string, CachedEnrich> = {};
    try {
      base = JSON.parse((await fs.readFile(f, "utf8")) || "{}");
    } catch {}
    await fs.writeFile(f, JSON.stringify({ ...base, ...map }, null, 2));
  } catch {}
}
