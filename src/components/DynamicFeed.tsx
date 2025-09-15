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

  React.useEffect(() => {
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
        // Samari風: タイトルは原文のまま、要約は日本語の1文。
        return fetch("/api/summarize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ items: head.map((i) => ({ id: i.id, title: i.title, url: i.url, excerpt: i.excerpt })) }),
        })
          .then((r) => r.json())
          .then((res) => {
            setTranslator(res?.provider ?? null);
            const map = new Map<string, { summaryJa?: string }>();
            for (const it of res.items ?? []) map.set(it.id, it);
            const mergedHead = head.map((i) => ({ ...i, summaryJa: map.get(i.id)?.summaryJa ?? i.excerpt }));
            setItems([...mergedHead, ...tail]);
          })
          .catch(() => setItems(list));
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
      {translator === "fallback" && (
        <div className="text-xs text-neutral-500">
          自動翻訳が未設定のため原文を表示しています（OpenAI/DeepL/LibreTranslate を設定可）。
        </div>
      )}
      {Object.entries(groups)
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([key, list]) => (
          <section key={key} className="space-y-2">
            <h2 className="text-sm font-medium text-neutral-500">
              {key === todayKey ? "今日" : formatJaHeading(key)}
            </h2>
            <FeedList items={list} />
          </section>
        ))}
      {items.length > visible && (
        <div className="pt-2">
          <button
            type="button"
            className="mx-auto block px-4 py-2 border border-neutral-300 rounded hover:bg-neutral-50"
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
