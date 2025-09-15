import React from "react";
import { FeedItem } from "@/lib/types";
import { formatJaDate } from "@/lib/utils";

export default function FeedItemRow({ item }: { item: FeedItem }) {
  return (
    <div className="group grid grid-cols-[auto,1fr,auto] items-start gap-4 py-4 border-b border-neutral-200">
      <div className="text-xs text-neutral-500 px-2 py-1 border border-neutral-300 rounded">
        {item.sourceName}
      </div>
      <div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[15px] leading-6 hover:underline"
        >
          {item.titleJa ?? item.title}
        </a>
        {(item.summaryJa || item.excerpt) && (
          <p className="mt-1 text-sm text-neutral-600">{item.summaryJa ?? item.excerpt}</p>
        )}
        <div className="mt-1 flex flex-wrap gap-2">
          <span className="text-[11px] uppercase tracking-wide text-neutral-500">{item.kind}</span>
          {item.tags?.map((t) => (
            <span key={t} className="text-[11px] text-neutral-600 border border-neutral-300 rounded px-1.5 py-0.5">
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="text-xs text-neutral-500 whitespace-nowrap">{item.publishedAt && !item.publishedAt.startsWith("1970-") ? formatJaDate(item.publishedAt) : "日付不明"}</div>
    </div>
  );
}
