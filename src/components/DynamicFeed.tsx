"use client";
import React from "react";
import FeedList from "./FeedList";
import { FeedItem } from "@/lib/types";
import { parseFeedXML } from "@/lib/parseFeed";

type Props = { group?: string; sourceSlug?: string };

export default function DynamicFeed({ group, sourceSlug }: Props) {
  const [items, setItems] = React.useState<FeedItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [translator, setTranslator] = React.useState<string | null>(null);
  const [visible, setVisible] = React.useState(30);
  const didRef = React.useRef(false);

  React.useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      if (didRef.current) return; // avoid double-run in React Strict Mode
      didRef.current = true;
    }
    let url = "/api/feeds";
    const p = new URLSearchParams();
    if (group) p.set("group", group);
    if (sourceSlug) p.set("source", sourceSlug);
    const qs = p.toString();
    if (qs) url += `?${qs}`;

    fetch(url, { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        const list: FeedItem[] = [];
        for (const r of data.results as any[]) {
          if (!r.ok) continue;
          if (r.format === "html-json" && Array.isArray(r.items)) {
            for (const it of r.items as any[]) {
              list.push({
                id: `${r.sourceSlug}-html-${it.url}`,
                title: it.title,
                url: it.url,
                // 取得元の公開日を優先。なければ未知扱い（1970-01-01）。
                publishedAt: it.publishedAt || "1970-01-01T00:00:00.000Z",
                sourceSlug: r.sourceSlug,
                sourceName: r.sourceName,
                kind: "blog",
                group: undefined,
                excerpt: it.excerpt,
              } as FeedItem);
            }
          } else if (r.body) {
            const parsed = parseFeedXML(r.body, r.sourceSlug, r.sourceName);
            list.push(...parsed);
          }
        }
        list.sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt));
        const head = list.slice(0, 20);
        const tail = list.slice(20);
        // 先に即時描画（原文/既存要約のまま）
        setItems(list);
        // 上位20件について、説明の翻訳＋本文要約を生成（後追い反映）
        return fetch("/api/enrich", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: head.map((i) => ({ id: i.id, title: i.title, url: i.url, excerpt: i.excerpt })) }),
        })
          .then((r) => r.json())
          .then((res) => {
            setTranslator(res?.provider ?? null);
            const map = new Map<string, { summaryJa?: string; excerptJa?: string }>();
            for (const it of res.items ?? []) map.set(it.id, it);
            const mergedHead = head.map((i) => ({
              ...i,
              summaryJa: map.get(i.id)?.summaryJa ?? i.summaryJa ?? i.excerpt,
              // 記述欄として翻訳済みexcerptも併せて保持
              excerptJa: map.get(i.id)?.excerptJa ?? (map.get(i.id) as any)?.descriptionJa,
            }));
            // 既存リストに反映（順序を維持）
            setItems((prev) => {
              const base = prev ?? list;
              const byId = new Map(base.map((x) => [x.id, x] as const));
              for (const m of mergedHead) byId.set(m.id, { ...byId.get(m.id)!, ...m });
              return Array.from(byId.values());
            });
          })
          .catch(() => {})
      })
      .catch((e) => setError(String(e)));
  }, [group, sourceSlug]);

  if (error) return <div className="text-sm text-red-600">フィード取得に失敗しました: {error}</div>;
  if (!items) return <div className="text-sm text-neutral-500">読み込み中...</div>;
  if (items.length === 0) return <div className="text-sm text-neutral-500">表示できる更新はありません。</div>;
  // 表示件数を制限（もっと見るで +30）
  const shown = items.slice(0, visible);

  // 日付ごとにグループ化（Samari参照）
  const groups = groupByDate(shown);
  const todayKey = toDateKey(new Date());

  return (
    <div className="space-y-4">
      {translator && (
        <div className="text-xs text-neutral-500">
          {translator === "fallback"
            ? "自動翻訳/要約が未設定のため原文ベースで表示しています。"
            : `要約/翻訳: ${translator}`}
        </div>
      )}
      {Object.entries(groups)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([key, list], idx) => {
          const isToday = key === todayKey;
          const label = isToday ? "今日" : formatJaHeading(key);
          const chip = "inline-flex items-center px-3 py-1 rounded-full border border-sky-200 bg-sky-50 text-sky-700 text-[12px] font-semibold tracking-wide";
          return (
            <section key={key} className={idx === 0 ? "" : "pt-6 mt-6 border-t border-neutral-200"}>
              <h2 className="text-sm text-neutral-500 text-left mb-3">
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
