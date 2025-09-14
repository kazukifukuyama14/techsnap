import Link from "next/link";
import React from "react";

const types = [
  { key: undefined, label: "すべて" },
  { key: "language", label: "言語" },
  { key: "framework", label: "フレームワーク" },
  { key: "library", label: "ライブラリ" },
] as const;

export default function TypeNav({ selected }: { selected?: string }) {
  return (
    <div className="border-y border-neutral-200">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto">
        <nav className="flex gap-2 py-3 text-sm whitespace-nowrap">
          {types.map((t) => {
            const active = (t.key ?? "") === (selected ?? "");
            const href = t.key ? `/?type=${t.key}` : "/";
            return (
              <Link
                key={t.label}
                href={href}
                className={
                  active
                    ? "px-3 py-1 rounded-full bg-neutral-900 text-white"
                    : "px-3 py-1 rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                }
              >
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

