import React from "react";
import { FeedItem } from "@/lib/types";
import FeedItemRow from "./FeedItemRow";

export default function FeedList({ items }: { items: FeedItem[] }) {
  return (
    <div className="divide-y divide-neutral-200">
      {items.map((i) => (
        <FeedItemRow key={i.id} item={i} />
      ))}
    </div>
  );
}

