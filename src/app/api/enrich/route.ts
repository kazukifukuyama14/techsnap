import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const dynamic = "force-dynamic";

type Item = { id: string; title: string; url: string; excerpt?: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items) ? body.items.slice(0, 20) : [];
  if (!items.length) return Response.json({ items: [] });
  const FAST = process.env.ENRICH_FAST === "1" || process.env.NODE_ENV === "development";

  // Try cache first
  const cached = await readEnrichCache(items.map((i) => i.id));
  if (items.every((i) => cached[i.id])) {
    const out = items.map((i) => ({ id: i.id, ...cached[i.id] }));
    return Response.json({ items: out, provider: "cache" });
  }

  // Fetch HTML with limited concurrency (skip in FAST mode)
  const htmls = FAST
    ? items.map((it) => ({ id: it.id, html: null as string | null }))
    : await runWithLimit(4, items.map((it) => async () => ({ id: it.id, html: await fetchArticleHtml(it.url) })));

  // Extract main text
  const contexts: Record<string, string> = {};
  for (const { id, html } of htmls) {
    if (!html) continue;
    const bodyFromDom = extractMainText(html);
    const bodyFromJsonLd = extractArticleBodyFromJsonLd(html);
    // 長い方（情報量が多い方）を採用
    contexts[id] = (bodyFromJsonLd.length > bodyFromDom.length ? bodyFromJsonLd : bodyFromDom).slice(0, 6000);
  }

  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    // Fallback: no translation/summarization, return original excerpts only
    return Response.json({
      items: items.map((i) => ({ id: i.id, excerptJa: i.excerpt, summaryJa: i.excerpt })),
      provider: "fallback",
    });
  }

  // Shape payload for OpenAI
  const shaped = items.map((it) => ({
    id: it.id,
    title: it.title,
    excerpt: (it.excerpt || "").slice(0, FAST ? 400 : 800),
    // reduce context size to speed up LLM; omit in FAST mode
    content: FAST ? "" : (contexts[it.id] || "").slice(0, 1500),
  }));

  const system = [
    "You are a Japanese editor for developer news.",
    "For each item, do both:",
    "1) descriptionJa: natural Japanese translation of excerpt (if empty, omit)",
    "2) summaryJa: a single Japanese sentence (90-120 chars) summarizing the article based on content.",
    "Rules: concise, neutral tone, end with 。, do not truncate mid-sentence, no emojis/hashtags. Output Japanese only.",
    "Do not include author names, dates, read-time (e.g., '10 min read'), UI words like Listen/Share/Press enter.",
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
    } as RequestInit);
    clearTimeout(tid);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "";
    const json = extractJson(content);
    let parsed: any = {};
    try {
      parsed = JSON.parse(json || "{}");
    } catch {}
    const obj: Record<string, { descriptionJa?: string; summaryJa?: string }> =
      parsed?.items && !Array.isArray(parsed.items) ? parsed.items : {};

    // まとめて日本語化が必要なフィールドを収集
    const toTranslate: Record<string, string> = {};
    for (const it of items) {
      const v = obj[it.id] || {};
      const candSum = v.summaryJa || heuristicSummary(contexts[it.id] || it.excerpt || "");
      // 既存 description、なければ excerpt を候補に
      const candDesc = v.descriptionJa || it.excerpt || undefined;
      if (candSum && needsJa(candSum)) toTranslate[`s:${it.id}`] = candSum;
      if (candDesc && needsJa(candDesc)) toTranslate[`d:${it.id}`] = candDesc;
      // さらに本文抜粋も用意（説明欄が弱い場合の埋め）
      const ctxSnippet = (contexts[it.id] || "").slice(0, 220);
      if (!candDesc && ctxSnippet && needsJa(ctxSnippet)) toTranslate[`e:${it.id}`] = ctxSnippet;
    }
    let translated: Record<string, string> = {};
    if (!FAST && Object.keys(toTranslate).length) translated = await translateBatchToJaOpenAI(toTranslate, key);

    const out: { id: string; excerptJa?: string; summaryJa?: string }[] = [];
    for (const it of items) {
      const v = obj[it.id] || {};
      // use cache if fresh
      const cacheHit = cached[it.id];
      let summary = translated[`s:${it.id}`] || v.summaryJa || heuristicSummary(contexts[it.id] || it.excerpt || "");
      let desc = translated[`d:${it.id}`] || v.descriptionJa || translated[`e:${it.id}`];
      if (!desc) {
        const fallback = (it.excerpt || contexts[it.id] || "").slice(0, 220);
        if (fallback) {
          if (needsJa(fallback)) {
            const solo = await translateBatchToJaOpenAI({ x: fallback }, key);
            desc = solo.x || fallback;
          } else {
            desc = fallback;
          }
        }
      }
      // 最終ガード: まだ英語なら個別翻訳を試行
      if (!FAST && summary && needsJa(summary)) {
        const solo = await translateBatchToJaOpenAI({ x: summary }, key);
        summary = solo.x || (await translatePlainJa(summary, key)) || summary;
      }
      // なお英語なら、本文から日本語1文要約を再生成
      if (!FAST && summary && needsJa(summary)) {
        const basis = (contexts[it.id] || it.excerpt || "").slice(0, 2000);
        if (basis) {
          const regen = await summarizeFromContentJa(it.title, basis, key);
          if (regen) summary = regen;
        }
      }
      // それでも英語なら、タイトル規則変換で日本語1文化
      if (summary && needsJa(summary)) {
        summary = ruleBasedJaSummary(it.title);
      }
      summary = finalizeSummary(summary);
      // 説明欄が英語なら最後に規則変換で簡易日本語に
      if (!desc || needsJa(desc)) desc = ruleBasedJaDescription(it.title);
      const finalItem = { id: it.id, excerptJa: desc ?? (it.excerpt || ""), summaryJa: tidySentence(summary) };
      out.push(finalItem);
      writeEnrichCache(it.id, finalItem).catch(() => {});
    }
    return Response.json({ items: out, provider: "openai" });
  } catch {
    // fallback: naive split of first sentence
    const out: { id: string; excerptJa?: string; summaryJa?: string }[] = [];
    for (const it of items) {
      const ctx = contexts[it.id] || it.excerpt || "";
      const first = finalizeSummary(heuristicSummary(ctx));
      const finalItem = { id: it.id, excerptJa: it.excerpt, summaryJa: tidySentence(first) };
      out.push(finalItem);
      writeEnrichCache(it.id, finalItem).catch(() => {});
    }
    return Response.json({ items: out, provider: "fallback" });
  }
}

// ---------- caching for enrich results ----------
const ENRICH_TTL = Number(process.env.ENRICH_TTL_SECONDS || 21600); // 6h
const ENRICH_DIR = ".next/cache/enrich";

async function readEnrichCache(ids: string[]) {
  const out: Record<string, { excerptJa?: string; summaryJa?: string }> = {};
  for (const id of ids) {
    try {
      const file = path.join(process.cwd(), ENRICH_DIR, safeName(id));
      const stat = await fs.stat(file);
      const age = (Date.now() - stat.mtimeMs) / 1000;
      if (age > ENRICH_TTL) continue;
      const j = JSON.parse(await fs.readFile(file, "utf8"));
      if (j && (j.excerptJa || j.summaryJa)) out[id] = j;
    } catch {}
  }
  return out;
}

async function writeEnrichCache(id: string, v: { excerptJa?: string; summaryJa?: string }) {
  try {
    const dir = path.join(process.cwd(), ENRICH_DIR);
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, safeName(id));
    await fs.writeFile(file, JSON.stringify(v), "utf8");
  } catch {}
}

function safeName(id: string) {
  return encodeURIComponent(id) + ".json";
}

// simple concurrency limiter
async function runWithLimit<T>(limit: number, tasks: (() => Promise<T>)[]) {
  const results: T[] = new Array(tasks.length) as any;
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) break;
      results[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchArticleHtml(url: string) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), 6000);
  try {
    const u = new URL(url);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        referer: u.origin + "/",
      },
      cache: "no-store",
      next: { revalidate: 0 },
    } as RequestInit);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

function extractMainText(html: string) {
  // Remove scripts/styles
  let doc = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

  // Prefer article/main sections
  const candidates = [
    matchFirst(doc, /<article[\s\S]*?<\/article>/i),
    matchFirst(doc, /<main[\s\S]*?<\/main>/i),
  ].filter(Boolean) as string[];

  let chunk = candidates[0] || longestTextBlock(doc);
  // Normalize block-level tags to line breaks
  chunk = chunk
    .replace(/<(h\d|p|li|div|section|br|hr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  const text = chunk.replace(/\s+/g, " ").replace(/\n\s*/g, "\n").trim();
  return text;
}

function extractArticleBodyFromJsonLd(html: string) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const out: string[] = [];
  while ((m = re.exec(html))) {
    const raw = m[1];
    try {
      const json = JSON.parse(raw);
      const nodes = Array.isArray(json) ? json : [json];
      for (const node of nodes) {
        if (!node) continue;
        const entries = node["@graph"] && Array.isArray(node["@graph"]) ? node["@graph"] : Array.isArray(node) ? node : [node];
        for (const e of entries) {
          if (!e) continue;
          if (e["@type"] === "BlogPosting" || e["@type"] === "NewsArticle") {
            const body = e.articleBody || e.description || "";
            if (typeof body === "string" && body.trim()) out.push(String(body));
          }
        }
      }
    } catch {}
  }
  const joined = out.join("\n\n");
  return joined.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function summarizeFromContentJa(title: string, content: string, key: string) {
  try {
    const system = [
      "You summarize developer articles in Japanese.",
      "Write exactly one Japanese sentence (90-120 chars) capturing the article's main point.",
      "No author names, dates, read-time, or UI words.",
    ].join("\n");
    const user = [
      `Title: ${title}`,
      "Content:",
      content.slice(0, 1800),
    ].join("\n");
    const body = {
      model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    } as any;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const s = j?.choices?.[0]?.message?.content?.trim() || "";
    return s;
  } catch {
    return "";
  }
}

function heuristicSummary(text: string) {
  if (!text) return "";
  const cleaned = text.replace(/\s+/g, " ").trim();
  const first = cleaned.split(/(?<=[。.!?])\s+/)[0] || cleaned;
  // 120字程度に収める（日本語/英語混在対応のため単純なlength）
  const max = 120;
  return first.length > max ? first.slice(0, max - 1) + "。" : first;
}

function tidySentence(s: string) {
  if (!s) return s;
  // 文末を句点で終えるように調整
  const trimmed = s.trim();
  if (/[。.!?]$/.test(trimmed)) return trimmed;
  return trimmed + "。";
}

function finalizeSummary(s: string) {
  if (!s) return s;
  // Normalize whitespace and strip quotes
  let t = s
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/^"|"$/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
  // If multiple sentences provided, keep first complete sentence
  const m = t.match(/^([\s\S]*?[。.!?])\s/);
  if (m) t = m[1];
  // Hard cap near 130 chars, prefer cutting at Japanese comma
  const max = 130;
  if (t.length > max) {
    const slice = t.slice(0, max);
    const p = Math.max(slice.lastIndexOf("。"), slice.lastIndexOf("!"), slice.lastIndexOf("?"));
    if (p >= 60) t = slice.slice(0, p + 1);
    else {
      const c = Math.max(slice.lastIndexOf("、"), slice.lastIndexOf(","));
      t = c >= 40 ? slice.slice(0, c + 1) : slice.trimEnd();
    }
  }
  // Avoid trailing comma/colon
  t = t.replace(/[、,;:、]+$/, "");
  // Drop common UI/meta noise at the end
  t = t.replace(/\b(min\s*read|Listen|Share|Press\s*enter)\b[\s\S]*$/i, "");
  return t;
}

function ruleBasedJaSummary(title: string) {
  const t = (title || "").trim();
  if (!t) return "記事の主要ポイントを日本語で要約。";
  const jp = replaceCommonPhrases(t);
  // 代表パターン
  if (/user survey results?/i.test(t)) return jp.replace(/\s+/g, " ") + "の結果概要を報告。";
  if (/(announces?|introduces?|unveils?)/i.test(t)) return jp.replace(/\s+/g, " ") + "を発表。";
  if (/(released?|releases?)/i.test(t)) return jp.replace(/\s+/g, " ") + "をリリース。";
  if (/(preview|beta)/i.test(t)) return jp.replace(/\s+/g, " ") + "のプレビューを公開。";
  if (/(guide|how\s*to|getting\s*started)/i.test(t)) return jp.replace(/\s+/g, " ") + "の概要と手順を解説。";
  if (/(deep\s*dive|in\s*depth)/i.test(t)) return jp.replace(/\s+/g, " ") + "の詳細を解説。";
  return jp.replace(/\s+/g, " ") + "に関する最新情報。";
}

function ruleBasedJaDescription(title: string) {
  const t = (title || "").trim();
  if (!t) return "記事の概要を日本語で紹介。";
  const jp = replaceCommonPhrases(t);
  if (/user survey results?/i.test(t)) return jp + "の結果について要点を紹介。";
  return jp + "の概要。";
}

function replaceCommonPhrases(s: string) {
  let t = s;
  t = t.replace(/Argo\s*CD/gi, "Argo CD");
  t = t.replace(/User\s*Survey\s*Results?/gi, "ユーザー調査結果");
  t = t.replace(/Results?/gi, "結果");
  t = t.replace(/Overview/gi, "概要");
  t = t.replace(/Guide/gi, "ガイド");
  t = t.replace(/Deep\s*Dive/gi, "詳細解説");
  t = t.replace(/Introduction/gi, "入門");
  // 年の表記にスペースを挿入して読みやすく
  t = t.replace(/(20\d{2})/g, "$1 年");
  return t;
}

function needsJa(s?: string) {
  if (!s) return false;
  const jp = (s.match(/[ぁ-んァ-ン一-龥々〆ヶ]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return jp < 1 && latin > 0;
}

async function translateBatchToJaOpenAI(texts: Record<string, string>, key: string) {
  try {
    const system = [
      "You are a professional translator.",
      "Translate all given values into natural Japanese.",
      "Return strictly JSON with the same keys and translated strings as values.",
    ].join("\n");
    const user = [
      "Input JSON mapping keys->text:",
      JSON.stringify(texts),
    ].join("\n");
    const body = {
      model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    } as any;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";
    const json = extractJson(content);
    const parsed = JSON.parse(json || "{}");
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed || {})) if (typeof v === "string") out[k] = v as string;
    // Fallback: fill missing keys with plain translation
    const missing = Object.keys(texts).filter((k) => !(k in out));
    if (missing.length) {
      for (const k of missing) {
        const t = await translatePlainJa(texts[k], key);
        if (t) out[k] = t;
      }
    }
    return out;
  } catch {
    return {} as Record<string, string>;
  }
}

async function translatePlainJa(text: string, key: string) {
  try {
    const system = "Translate into natural Japanese. Return only the translation.";
    const body = {
      model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: system },
        { role: "user", content: text.slice(0, 4000) },
      ],
      temperature: 0.1,
    } as any;
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    return j?.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

function longestTextBlock(html: string) {
  // find the longest block of <p>...</p>
  const re = /<p[^>]*>[\s\S]*?<\/p>/gi;
  const blocks = html.match(re) || [];
  let best = "";
  for (const b of blocks) if (b.length > best.length) best = b;
  return best || html;
}

function matchFirst(s: string, re: RegExp) {
  const m = s.match(re);
  return m ? m[0] : "";
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}
