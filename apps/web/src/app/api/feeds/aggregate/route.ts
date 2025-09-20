import { NextRequest } from "next/server";
import { sources } from "@/lib/data";
import { getFirestoreAdmin, getFirestoreInitError } from "@/lib/server/firestore";
import {
  computeExpiry,
  getDateKey,
  isFresh,
  readAggregateCache,
  writeAggregateCache,
} from "@/lib/server/feedCache";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const { searchParams, origin } = new URL(req.url);
    const group = searchParams.get("group") as any | null;
    const limitPerSource = Math.max(1, Math.min(25, +(searchParams.get("limitPerSource") || 8)));
    const only = searchParams.getAll("source");
    const now = new Date();
    const dateKey = getDateKey(now);
    const cacheKey = group || "all";

    const db = getFirestoreAdmin();
    if (db && only.length === 0) {
      const cached = await readAggregateCache(db, cacheKey, dateKey);
      if (cached && isFresh(cached, now)) {
        return Response.json({ items: cached.items, cache: "hit", fetchedAt: cached.fetchedAt });
      }
    }

    const list = sources
      .filter((s) => (group ? s.group === group : true))
      .filter((s) => (only.length ? only.includes(s.slug) : true));

    const tasks = list.map((s) => async () => await fetchJson(`${origin}/api/feeds?slug=${encodeURIComponent(s.slug)}&limit=${limitPerSource}`));
    const results = await runWithLimit(6, tasks);
    const merged = results
      .flatMap((r) => (Array.isArray(r?.items) ? r.items : []))
      .filter(Boolean)
      .sort((a: any, b: any) => +new Date(b.publishedAt) - +new Date(a.publishedAt));

    if (db && only.length === 0 && merged.length) {
      await writeAggregateCache(db, cacheKey, dateKey, {
        items: merged,
        fetchedAt: now.toISOString(),
        expiresAt: computeExpiry(now),
      });
    }

    return Response.json({ items: merged, cache: "miss" });
  } catch (e: any) {
    console.error("/api/feeds/aggregate error", e);
    console.error("stack:", e?.stack);
    const initError = getFirestoreInitError();
    return Response.json({
      error: typeof e === "object" && e ? { message: String(e.message || e), code: (e as any)?.code } : String(e ?? "Unknown error"),
      firestoreInitError: initError ? String(initError.message || initError) : undefined,
      items: [],
    }, { status: 500 });
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

