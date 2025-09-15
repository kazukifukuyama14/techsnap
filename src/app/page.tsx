import React from "react";
import { GROUP_LABELS } from "@/lib/data";
import DynamicFeed from "@/components/DynamicFeed";

export default async function Home(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await props.searchParams;
  const group = (sp?.group ?? undefined) as any;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">
        最新の更新{group ? ` — ${GROUP_LABELS[group as keyof typeof GROUP_LABELS]}` : ""}
      </h1>
      <DynamicFeed group={group} />
    </div>
  );
}
