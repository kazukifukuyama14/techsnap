import React from "react";
import { GROUP_LABELS, listSources } from "@/lib/data";

export default function SourcesIndex() {
  const groups = ["development", "cloud", "libraries", "programming"] as const;
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">ソース一覧</h1>
      {groups.map((g) => {
        const list = listSources(g as any);
        return (
          <section key={g}>
            <h2 className="text-sm uppercase tracking-wide text-neutral-500 mb-3">
              {GROUP_LABELS[g as keyof typeof GROUP_LABELS]}
            </h2>
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {list.map((s) => (
                <li key={s.slug}>
                  <a
                    href={`/sources/${s.slug}`}
                    className="block border border-neutral-200 rounded px-4 py-3 hover:bg-neutral-50"
                  >
                    <div className="font-medium">{s.name}</div>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
