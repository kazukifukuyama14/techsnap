import { notFound } from "next/navigation";
import React from "react";
import { GROUP_LABELS, getSource } from "@/lib/data";
import DynamicFeed from "@/components/DynamicFeed";

type Params = { params: { slug: string } };

export function generateStaticParams() {
  // 動的でも問題ないが、サンプルでは静的生成
  return [];
}

export default async function SourcePage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await params;
  const source = getSource(p.slug);
  if (!source) return notFound();
  return (
    <div className="space-y-6">
      <header>
        <div className="text-sm text-neutral-500">{GROUP_LABELS[source.group]}</div>
        <h1 className="text-2xl font-semibold">{source.name}</h1>
        {source.siteUrl && (
          <a href={source.siteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-600 underline">
            公式サイトを開く
          </a>
        )}
      </header>
      <DynamicFeed sourceSlug={source.slug} />
    </div>
  );
}
