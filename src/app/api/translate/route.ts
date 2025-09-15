import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

type Item = { id: string; title: string; excerpt?: string };

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: Item[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return Response.json({ items: [] });

  // 優先: OpenAI → DeepL → LibreTranslate → フォールバック（原文返却）
  const provider = process.env.TRANSLATION_PROVIDER || detectProvider();
  try {
    if (provider === "openai" && process.env.OPENAI_API_KEY) {
      const res = await translateWithOpenAI(items, process.env.OPENAI_API_KEY!);
      return Response.json({ items: res, provider });
    }
    if (provider === "deepl" && process.env.DEEPL_API_KEY) {
      const res = await translateWithDeepL(items, process.env.DEEPL_API_KEY!);
      return Response.json({ items: res, provider });
    }
    if (provider === "libre" && process.env.LIBRETRANSLATE_URL) {
      const res = await translateWithLibre(items, process.env.LIBRETRANSLATE_URL!);
      return Response.json({ items: res, provider });
    }
  } catch (e: any) {
    // fallthrough
  }

  // フォールバック: 原文をそのまま返却
  return Response.json({
    items: items.map((i) => ({ id: i.id, titleJa: i.title, summaryJa: i.excerpt })),
    provider: "fallback",
  });
}

function detectProvider() {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.DEEPL_API_KEY) return "deepl";
  if (process.env.LIBRETRANSLATE_URL) return "libre";
  return "fallback";
}

async function translateWithOpenAI(items: Item[], key: string) {
  // 入力を短縮（抜粋は長くなりすぎないように）
  const shaped = items.map(({ id, title, excerpt }) => ({
    id,
    title,
    excerpt: (excerpt || "").slice(0, 600),
  }));

  const system = [
    "You are a professional Japanese technical editor.",
    "Task: For each item, provide:",
    "- titleJa: Natural Japanese translation of title (no quotes)",
    "- summaryJa: 60-100 Japanese characters concisely summarizing the article's main point.",
    "Style: concise, neutral, no emojis, no hashtags.",
  ].join("\n");

  const user = [
    "Return strictly as JSON with object shape:",
    '{"items": {"<id>": {"titleJa": "...", "summaryJa": "..."}, ...}}',
    "Do not include any extra commentary.",
    "Items:",
    JSON.stringify(shaped),
  ].join("\n");

  const body = {
    model: process.env.OPENAI_TRANSLATE_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    temperature: 0.2,
  } as any;

  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || "";

  // JSON を厳密に抽出（前後にテキストが混じる場合に備える）
  const jsonText = extractJson(content);
  let data: any = {};
  try {
    data = JSON.parse(jsonText);
  } catch {
    // もし配列で返ってきたら id でマッピングして受け取る
    try {
      const arr = JSON.parse(jsonText || "[]");
      if (Array.isArray(arr)) {
        const m: Record<string, { titleJa?: string; summaryJa?: string }> = {};
        for (const it of arr) if (it?.id) m[it.id] = { titleJa: it.titleJa, summaryJa: it.summaryJa };
        data = { items: m };
      }
    } catch {}
  }
  const map: Record<string, { titleJa?: string; summaryJa?: string }> = data?.items || {};
  return items.map((i) => ({ id: i.id, titleJa: map[i.id]?.titleJa ?? i.title, summaryJa: map[i.id]?.summaryJa ?? i.excerpt }));
}

function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

async function translateWithDeepL(items: Item[], key: string) {
  // DeepLでは翻訳のみ（要約はexcerptを翻訳）
  async function deepl(text: string) {
    const params = new URLSearchParams({ text, target_lang: "JA" });
    const r = await fetch("https://api-free.deepl.com/v2/translate", {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const j = await r.json();
    return j?.translations?.[0]?.text ?? text;
  }
  const out: any[] = [];
  for (const it of items) {
    const titleJa = await deepl(it.title);
    const summaryJa = it.excerpt ? await deepl(it.excerpt) : undefined;
    out.push({ id: it.id, titleJa, summaryJa });
  }
  return out;
}

async function translateWithLibre(items: Item[], baseUrl: string) {
  async function libre(text: string) {
    const r = await fetch(`${baseUrl.replace(/\/$/, "")}/translate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ q: text, source: "auto", target: "ja", format: "text" }),
    });
    const j = await r.json();
    return j?.translatedText ?? text;
  }
  const out: any[] = [];
  for (const it of items) {
    const titleJa = await libre(it.title);
    const summaryJa = it.excerpt ? await libre(it.excerpt) : undefined;
    out.push({ id: it.id, titleJa, summaryJa });
  }
  return out;
}
