import { NextRequest } from "next/server";
import { sources } from "@/lib/data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams, origin } = new URL(req.url);
    const group = searchParams.get("group") as any | null;
    const limitPerSource = Math.max(1, Math.min(25, +(searchParams.get("limitPerSource") || 8)));
    const only = searchParams.getAll("source"); // optional repeated query

    const list = sources.filter((s) => (group ? s.group === group : true)).filter((s) => (only.length ? only.includes(s.slug) : true));
    const tasks = list.map((s) => async () => await fetchJson(`${origin}/api/feeds?slug=${encodeURIComponent(s.slug)}&limit=${limitPerSource}`));
    const results = await runWithLimit(6, tasks);
    const merged = results
      .flatMap((r) => Array.isArray(r?.items) ? r.items : [])
      .filter(Boolean)
      .sort((a: any, b: any) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
    return Response.json({ items: merged });
  } catch (e: any) {
    return Response.json({ error: String(e), items: [] }, { status: 500 });
  }
}

async function fetchJson(url: string): Promise<any> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return { items: [] };
    return await r.json();
  } catch {
    return { items: [] };
  }
}

async function runWithLimit<T>(limit: number, tasks: (() => Promise<T>)[]) {
  const out: T[] = new Array(tasks.length);
  let i = 0;
  const workers = new Array(Math.min(limit, tasks.length)).fill(0).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= tasks.length) break;
      out[idx] = await tasks[idx]();
    }
  });
  await Promise.all(workers);
  return out;
}

