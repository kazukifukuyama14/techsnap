import React from "react";
import { GROUP_LABELS, listFeedItems } from "@/lib/data";
import FeedList from "@/components/FeedList";

export default function Home({ searchParams }: { searchParams?: { group?: string } }) {
  const group = searchParams?.group as any | undefined;
  const items = listFeedItems({ group });
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        最新の更新{group ? ` — ${GROUP_LABELS[group as keyof typeof GROUP_LABELS]}` : ""}
      </h1>
      <FeedList items={items} />
    </div>
  );
}
