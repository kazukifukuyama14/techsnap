import { notFound } from "next/navigation";
import React from "react";
import { GROUP_LABELS, getSource } from "@/lib/data";
import { iconPath } from "@/lib/icons";
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
      <header className="text-center space-y-2">
        <div className="text-sm text-neutral-500">{GROUP_LABELS[source.group]}</div>
        <div className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {iconPath(source.slug) && (
            <img src={iconPath(source.slug)!} alt="" className="w-6 h-6 object-contain" />
          )}
          <h1 className="text-2xl font-semibold">{source.name}</h1>
        </div>
        {source.siteUrl && (
          <a href={source.siteUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-600 underline">
            公式サイトを開く
          </a>
        )}
      </header>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-center gap-2 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {iconPath(source.slug) && (
            <img src={iconPath(source.slug)!} alt="" className="w-4 h-4 object-contain" />
          )}
          <p className="text-sm text-neutral-600">
            {source.name} の公式ブログ/ドキュメント更新を集約して表示します。
          </p>
        </div>
      </div>
      <DynamicFeed sourceSlug={source.slug} />
    </div>
  );
}
