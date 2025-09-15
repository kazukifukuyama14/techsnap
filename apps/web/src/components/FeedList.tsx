import React from "react";
import FeedItemRow from "@/components/FeedItemRow";
import { FeedItem } from "@/lib/types";

export default function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <div className="divide-y divide-neutral-200">
      {items.map((it) => (
        <FeedItemRow key={it.id} item={it} />
      ))}
    </div>
  );
}
