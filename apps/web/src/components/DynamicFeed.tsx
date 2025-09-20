"use client";
import React from "react";
import FeedList from "@/components/FeedList";
import { FeedItem } from "@/lib/types";
import { listFeedItems } from "@/lib/data";

export default function DynamicFeed({ group, sourceSlug }: { group?: string; sourceSlug?: string }) {
  const [items, setItems] = React.useState<FeedItem[] | null>(null);
  const [visible, setVisible] = React.useState(50);
  const [error, setError] = React.useState<string | null>(null);
  const processedIdsRef = React.useRef<Set<string>>(new Set());
  const enrichingRef = React.useRef(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      processedIdsRef.current = new Set();
      enrichingRef.current = false;
      // 1) ベース記事: source 指定があればそのフィード、なければ全ソースの集約
      let base: FeedItem[] = [];
      try {
        if (sourceSlug) {
          const r = await fetch(`/api/feeds?slug=${encodeURIComponent(sourceSlug)}&limit=50`, { cache: "no-store" });
          const data = await r.json();
          base = (data.items || []) as FeedItem[];
        } else {
          const url = new URL(`/api/feeds/aggregate`, location.origin);
          if (group) url.searchParams.set("group", String(group));
          url.searchParams.set("limitPerSource", "8");
          const r = await fetch(url.toString(), { cache: "no-store" });
          const data = await r.json();
          base = (data.items || []) as FeedItem[];
        }
      } catch {}
      if (cancelled) return;
      // 最新日付順にソート
      base.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
      setItems(base);

    }
    load();
    return () => { cancelled = true; };
  }, [group, sourceSlug]);


  React.useEffect(() => {
    if (!items || enrichingRef.current) return;
    const slice = items.slice(0, visible);
    const targets: { id: string; title: string; url: string; excerpt?: string }[] = [];
    for (const it of slice) {
      if (!processedIdsRef.current.has(it.id) && !it.summaryJa) {
        processedIdsRef.current.add(it.id);
        targets.push({ id: it.id, title: it.title, url: (it as any).url, excerpt: it.excerpt });
      }
    }
    if (!targets.length) return;

    enrichingRef.current = true;
    fetch("/api/enrich", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: targets }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (!res?.items) return;
        const map = new Map<string, any>();
        for (const it of res.items ?? []) map.set(it.id, it);
        setItems((prev) => {
          if (!prev) return prev;
          const byId = new Map(prev.map((x) => [x.id, x] as const));
          for (const target of targets) {
            const baseItem = byId.get(target.id);
            if (!baseItem) continue;
            const payload = map.get(target.id) ?? {};
            byId.set(target.id, {
              ...baseItem,
              summaryJa: payload.summaryJa ?? baseItem.summaryJa ?? baseItem.excerpt,
            });
          }
          return Array.from(byId.values());
        });
      })
      .catch(() => {})
      .finally(() => {
        enrichingRef.current = false;
      });
  }, [items, visible]);

  if (error) return <div className="text-sm text-red-600">フィード取得に失敗しました: {error}</div>;
  if (!items) return <div className="text-sm text-neutral-500">読み込み中...</div>;
  if (items.length === 0) return <div className="text-sm text-neutral-500">表示できる更新はありません。</div>;

  const shown = items.slice(0, visible);
  // 日付ごとにグループ化し、見出しを付けて表示
  const groups = groupByDate(shown);
  const todayKey = toDateKey(new Date());

  return (
    <div className="space-y-6">
      {Object.entries(groups)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([key, list], idx) => {
          const isToday = key === todayKey;
          const label = isToday ? "今日" : formatJaHeading(key);
          const chip = "inline-flex items-center px-3 py-1 rounded-full border border-sky-200 bg-sky-50 text-sky-700 text-[12px] font-semibold tracking-wide";
          return (
            <section key={key} className={idx === 0 ? "" : "pt-4 border-t border-neutral-200"}>
              <h2 className="text-sm text-neutral-500 mb-3">
                <span className={chip}>{label}</span>
              </h2>
              <FeedList items={list} />
            </section>
          );
        })}
      {items.length > visible && (
        <div className="pt-2">
          <button
            type="button"
            className="mx-auto block px-4 py-2 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
            onClick={() => setVisible((v) => v + 30)}
          >
            もっと見る
          </button>
        </div>
      )}
    </div>
  );
}

function toDateKey(d: Date) {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function groupByDate(list: FeedItem[]) {
  const groups: Record<string, FeedItem[]> = {};
  for (const it of list) {
    const d = new Date(it.publishedAt);
    const invalid = !it.publishedAt || isNaN(d.getTime()) || it.publishedAt.startsWith("1970-");
    const key = invalid ? "unknown" : toDateKey(d);
    (groups[key] ||= []).push(it);
  }
  return groups;
}

function formatJaHeading(key: string) {
  if (key === "unknown") return "日付不明";
  const [y, m, d] = key.split("-");
  return `${y}年${parseInt(m, 10)}月${parseInt(d, 10)}日`;
}
