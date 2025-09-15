import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Item = { id: string; title: string; url: string; excerpt?: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  if (!items.length) return Response.json({ items: [] });
  // 明示的に ENRICH_FAST=1 のときのみ高速モード。開発環境でも全文要約の品質を優先。
  const FAST = process.env.ENRICH_FAST === "1";
  const PROVIDER = (process.env.TRANSLATION_PROVIDER || "openai").toLowerCase();

  // Try cache first
  const cached = await readEnrichCache(items.map((i) => i.id));
  if (items.every((i) => cached[i.id])) {
    const out = items.map((i) => ({ id: i.id, ...cached[i.id] }));
    return Response.json({ items: out, provider: "cache" });
  }

  // Fetch HTML with limited concurrency (skip in FAST mode)
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

  // Extract main text
  const contexts: Record<string, string> = {};
  for (const { id, html } of htmls) {
    if (!html) continue;
    const bodyFromDom = extractMainText(html);
    const bodyFromJsonLd = extractArticleBodyFromJsonLd(html);
    // 長い方（情報量が多い方）を採用
    const chosen = bodyFromJsonLd.length > bodyFromDom.length ? bodyFromJsonLd : bodyFromDom;
    contexts[id] = decodeEntities(chosen).slice(0, 6000);
  }

  // DeepL プロバイダ: 英文の一文候補を自前生成→DeepL で日本語化
  if (PROVIDER === "deepl") {
    try {
      const englishOneLiners = items.map((it) => {
        const ctx = sanitizeForModel((contexts[it.id] || "").trim()).slice(0, 3000);
        const base = sanitizeForModel(((it.excerpt && it.excerpt.trim()) ? it.excerpt : it.title) || "");
        const title = sanitizeForModel(it.title || "");
        const candidate = pickKeySentence(ctx || base, title);
        return (candidate || base || title).slice(0, 240);
      });
      const ja = await translateToJaDeepL(englishOneLiners);
      const out = items.map((it, idx) => ({ id: it.id, summaryJa: cleanSummary(ja[idx] || englishOneLiners[idx]) }));
      const map: Record<string, any> = {};
      for (const o of out) map[o.id] = o;
      await writeEnrichCache(map);
      return Response.json({ items: out, provider: "deepl" });
    } catch {
      return Response.json({ items: items.map((i) => ({ id: i.id, summaryJa: i.excerpt || i.title })), provider: "fallback" });
    }
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Fallback when OpenAI key missing
    return Response.json({
      items: items.map((i) => ({ id: i.id, summaryJa: i.excerpt || i.title })),
      provider: "fallback",
    });
  }

  // Shape payload for OpenAI
  const shaped = items.map((it) => ({
    id: it.id,
    title: it.title,
    // excerpt が空ならタイトルで代替し、モデルが要約材料を必ず持つようにする
    excerpt: sanitizeForModel(decodeEntities((it.excerpt && it.excerpt.trim()) ? it.excerpt : it.title)).slice(0, FAST ? 400 : 800),
    // reduce context size to speed up LLM; omit in FAST mode
    content: FAST ? "" : (contexts[it.id] || "").slice(0, 3000),
  }));

  const system = [
    "You are a Japanese tech editor.",
    "For each item, output two fields:",
    "1) descriptionJa: faithful Japanese translation of excerpt (if empty, omit)",
    "2) summaryJa: one concise Japanese sentence (90-120 chars) that synthesizes the main point across title and content.",
    "Important rules:",
    "- Do NOT copy the excerpt; write a new sentence in Japanese.",
    "- Prefer facts from content over the excerpt; if content is missing, infer from title+excerpt.",
    "- No URLs, markdown, emojis, hashtags, or quotation marks.",
    "- Neutral tone, end with 。, and avoid trailing ellipses.",
  ].join("\n");

  const user = [
    "Return strictly as JSON with shape:",
    '{"items": {"<id>": {"descriptionJa": "...", "summaryJa": "..."}, ...}}',
    "Items:",
    JSON.stringify(shaped),
  ].join("\n");

  const bodyReq = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  } as any;

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), FAST ? 12000 : 22000);
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(bodyReq),
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content || "";
    const parsed = safeParseJsonObject(content);
    let out = items.map((it) => ({
      id: it.id,
      titleJa: cleanSummary(parsed?.items?.[it.id]?.descriptionJa),
      summaryJa: cleanSummary(parsed?.items?.[it.id]?.summaryJa),
    }));

    // 全件を最終的に日本語へ強制（コストは増えるが確実性を優先）
    try {
      const inputsAll = out.map((o, i) => sanitizeForModel(decodeEntities(o.summaryJa || items[i]?.excerpt || items[i]?.title || "")).slice(0, 400));
      let translatedAll = await translateToJa(inputsAll);
      // 万一パース失敗や未翻訳が混じる場合は、1件ずつ翻訳で補完
      const needIdx: number[] = [];
      translatedAll = translatedAll || [];
      for (let i = 0; i < inputsAll.length; i++) {
        const t = translatedAll[i];
        if (!t || !looksJapanese(t)) needIdx.push(i);
      }
      if (needIdx.length) {
        const fixed = await runWithLimit(4, needIdx.map((idx) => async () => await translateOneToJa(inputsAll[idx])));
        for (let k = 0; k < needIdx.length; k++) {
          translatedAll[needIdx[k]] = fixed[k] || translatedAll[needIdx[k]] || inputsAll[needIdx[k]];
        }
      }
      out = out.map((o, i) => ({ ...o, summaryJa: cleanSummary(String(translatedAll[i] || o.summaryJa || "")) }));
    } catch {}

    // cache
    const map: Record<string, any> = {};
    for (const o of out) map[o.id] = o;
    await writeEnrichCache(map);
    return Response.json({ items: out, provider: "openai" });
  } catch (e) {
    // エラー時は英語excerptをそのまま返す（UIで日本語未変換として表示）
    return Response.json({ items: items.map((i) => ({ id: i.id, summaryJa: i.excerpt || i.title })) });
  }
}

// Helpers
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
  // 1) Try <article> block
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i);
  const article = articleMatch?.[0] || "";
  const articleText = stripHtml(article);
  if (articleText && articleText.length > 800) return articleText;

  // 2) Extract top paragraphs as fallback
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "");
  const pMatches = cleaned.match(/<p[\s\S]*?<\/p>/gi) || [];
  // score paragraphs by length and prefer those with punctuation
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

function firstGoodSentence(text: string): string | null {
  const parts = text
    .replace(/\n+/g, " ")
    .split(/(?<=[\.!?。！？])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of parts) {
    if (s.length >= 60 && s.length <= 240) return s;
  }
  return parts[0] || null;
}

function pickKeySentence(text: string, title?: string): string | null {
  if (!text) return title || null;
  const sentences = splitIntoSentences(text);
  if (!sentences.length) return title || null;
  const verbs = [
    /\b(add|introduc(e|es|ed|ing)|bring|ship|release|laun(ch|ched)|support|enable|allow)s?\b/i,
    /\bimprov(e|es|ed|ing)|optim(ize|ised|ized)|enhanc(e|ed|es)\b/i,
    /\bfix|address|resolv(e|ed|es)|patch\b/i,
    /\bdeprecat(e|ed|es)|remov(e|ed|es)\b/i,
    /\bsecurity|vuln(erability|)|CVE-?\d{4}-\d+\b/i,
  ];
  function score(s: string, idx: number): number {
    let sc = 0;
    const len = s.length;
    if (len >= 60 && len <= 220) sc += 4; else if (len >= 40 && len <= 260) sc += 2;
    for (const v of verbs) if (v.test(s)) sc += 5;
    if (/\bv?\d+\.\d+(?:\.\d+)?\b/i.test(s)) sc += 3; // version number
    if (/\b(beta|rc|ga|stable|lts)\b/i.test(s)) sc += 2;
    if (idx <= 2) sc += 1; // slight preference to early sentences
    if (title && new RegExp(title.split(/\s+/).slice(0,2).join(' '), 'i').test(s)) sc += 1;
    // penalize boilerplate
    if (/cookies|subscribe|sign up|privacy|share on|follow us/i.test(s)) sc -= 5;
    return sc;
  }
  let best = sentences[0];
  let bestScore = -1e9;
  sentences.forEach((s, i) => {
    const sc = score(s, i);
    if (sc > bestScore) { bestScore = sc; best = s; }
  });
  return best || sentences[0] || null;
}

function splitIntoSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[\.!?。！？])\s+/)
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeForModel(s: string) {
  return (s || "")
    .replace(/https?:\/\/\S+/g, " ") // drop URLs
    .replace(/\[[^\]]+\]\([^\)]+\)/g, " ") // drop markdown links
    .replace(/\s+/g, " ")
    .trim();
}

function looksJapanese(s?: string) {
  if (!s) return false;
  // 平仮名・片仮名・漢字のいずれかを含むか簡易判定
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(s);
}

function decodeEntities(s: string) {
  if (!s) return s;
  return s
    .replace(/&#(x?[0-9A-Fa-f]+);/g, (_, code) => {
      try {
        const cp = String(code).toLowerCase().startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10);
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
      } catch { return _; }
    })
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
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

async function translateOneToJa(text: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return text;
  const sys = "Translate to Japanese in one sentence (90-120 chars). No URLs/emojis/markdown. Output plain text only.";
  const body = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: text },
    ],
    temperature: 0,
  } as any;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    if (!r.ok) return text;
    const data = await r.json();
    return String(data?.choices?.[0]?.message?.content || text);
  } catch {
    return text;
  }
}

function safeParseJsonObject(s: string): any {
  // try direct
  try { return JSON.parse(s); } catch {}
  // try code block
  const m = s.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // try array only
  const a = s.match(/\[[\s\S]*\]/);
  if (a) { try { return { items: JSON.parse(a[0]) }; } catch {} }
  return {};
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

async function readEnrichCache(ids: string[]) {
  try {
    const f = path.join(process.cwd(), ".next", "cache", "enrich.json");
    const txt = await fs.readFile(f, "utf8").catch(() => "{}");
    const data = JSON.parse(txt || "{}");
    const out: Record<string, any> = {};
    for (const id of ids) if (data[id]) out[id] = data[id];
    return out;
  } catch {
    return {} as Record<string, any>;
  }
}

async function writeEnrichCache(map: Record<string, any>) {
  try {
    const f = path.join(process.cwd(), ".next", "cache", "enrich.json");
    await fs.mkdir(path.dirname(f), { recursive: true });
    let base: Record<string, any> = {};
    try {
      base = JSON.parse((await fs.readFile(f, "utf8")) || "{}");
    } catch {}
    await fs.writeFile(f, JSON.stringify({ ...base, ...map }, null, 2));
  } catch {}
}
