import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Item = { id: string; title: string; url: string; excerpt?: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return Response.json({ items: [] });

  // まずは excerpt のみで軽量要約（HTML深掘りはデフォルト無効）
  const shaped = items.map((it) => ({ id: it.id, title: it.title, excerpt: (it.excerpt || "").slice(0, 800) }));
  const batched = chunk(shaped, 12);
  const out: { id: string; summaryJa?: string }[] = [];
  for (const batch of batched) {
    const map = await summarizeBatch(batch);
    for (const it of batch) out.push({ id: it.id, summaryJa: map[it.id] });
  }
  return Response.json({ items: out, provider: "openai" });
}

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      cache: "no-store",
      next: { revalidate: 0 },
    } as RequestInit);
    return await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(id);
  }
}

function extractMainText(html: string) {
  // タグ除去の前に記事本体らしきブロックを粗く抽出
  const lower = html.toLowerCase();
  let chunk = matchFirst(html, /<article[\s\S]*?<\/article>/i)
    || matchFirst(html, /<main[\s\S]*?<\/main>/i)
    || matchFirst(html, /<div[^>]+class=["'][^"']*(content|article|post|entry|markdown)[^"']*["'][\s\S]*?<\/div>/i)
    || html;
  // script/style/noscript を削除
  chunk = chunk
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  // p, li を改行に
  chunk = chunk.replace(/<(p|li|br)\b[^>]*>/gi, "\n");
  // 残りのタグ除去
  const text = chunk.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  // 余計な空白圧縮
  const cleaned = text.replace(/\s+/g, " ").replace(/\n\s*/g, "\n").trim();
  return cleaned.slice(0, 4000);
}

function matchFirst(s: string, re: RegExp) {
  const m = s.match(re);
  return m ? m[0] : null;
}

async function summarizeBatch(items: { id: string; title: string; excerpt: string }[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key || items.length === 0) {
    // ローカルフォールバック（抽出要約）
    const out: Record<string, string> = {};
    for (const it of items) out[it.id] = heuristicSummary(it.title, it.excerpt || "");
    return out;
  }
  const system = [
    "You are a concise Japanese summarizer for developer news.",
    "For each item, write a single Japanese sentence (90-130 chars) summarizing the essential update.",
    "No emojis, no quotes, no marketing fluff. Output Japanese only.",
    "Do not include author names, dates, read-time (e.g., '10 min read'), UI words like Listen/Share/Press enter.",
  ].join("\n");
  const user = [
    "Return JSON object: { \"items\": { \"<id>\": { \"summaryJa\": \"...\" }, ... } }",
    "Items:",
    JSON.stringify(items),
  ].join("\n");
  const body = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  } as any;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "";
    const json = extractJson(content);
    const parsed = JSON.parse(json || "{}") as { items?: Record<string, { summaryJa?: string }> };
    // 日本語でない要約をまとめて翻訳
    const toTranslate: Record<string, string> = {};
    for (const [id, v] of Object.entries(parsed.items || {})) {
      const s = v?.summaryJa || "";
      if (s && needsJa(s)) toTranslate[id] = s;
    }
    let translated: Record<string, string> = {};
    if (Object.keys(toTranslate).length) translated = await translateBatchToJaOpenAI(toTranslate, process.env.OPENAI_API_KEY!);
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(parsed.items || {})) {
      let s = translated[id] || v?.summaryJa || "";
      if (!s) continue;
      if (needsJa(s)) s = (await translatePlainJa(s, process.env.OPENAI_API_KEY!)) || s;
      out[id] = finalizeSummary(s);
    }
    return out;
  } catch {
    // エラー時はフォールバック
    const out: Record<string, string> = {};
    for (const it of items) out[it.id] = finalizeSummary(heuristicSummary(it.title, it.excerpt || ""));
    return out;
  }
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function chunk<T>(arr: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function heuristicSummary(title: string, excerpt: string) {
  const src = (excerpt || title || "").replace(/https?:\/\/\S+/g, "");
  // 文区切り（ピリオド/日本語句点）
  const first = (src.split(/(?<=[。.!?])\s+/)[0] || src).trim();
  const trimmed = first.replace(/\s+/g, " ");
  // 90–130字に近づける（英語は文字数で切る）
  const max = 130;
  if (trimmed.length <= max) return trimmed;
  // prefer cut at Japanese comma
  const slice = trimmed.slice(0, max);
  const comma = Math.max(slice.lastIndexOf("、"), slice.lastIndexOf(","));
  return (comma >= 60 ? slice.slice(0, comma + 1) : slice.trimEnd());
}

function finalizeSummary(s: string) {
  if (!s) return s;
  let t = s
    .replace(/[\s\u00A0]+/g, " ")
    .replace(/^"|"$/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .trim();
  const m = t.match(/^([\s\S]*?[。.!?])\s/);
  if (m) t = m[1];
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
  t = t.replace(/[、,;:、]+$/, "");
  t = t.replace(/\b(min\s*read|Listen|Share|Press\s*enter)\b[\s\S]*$/i, "");
  // Ensure end punctuation
  if (!/[。.!?]$/.test(t)) t += "。";
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
