"use client";
import React from "react";
import Link from "next/link";
import { GROUP_LABELS, listSources } from "@/lib/data";
import { iconPath } from "@/lib/icons";

function HamburgerIcon({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  );
}

export default function MobileMenu() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (open) document.body.classList.add("overflow-hidden");
    else document.body.classList.remove("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [open]);

  const groups = ["development", "cloud", "libraries", "programming"] as const;

  return (
    <>
      {/* フローティングボタン */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="lg:hidden fixed left-1/2 -translate-x-1/2 bottom-5 z-50 inline-flex items-center justify-center w-14 h-14 rounded-full border border-neutral-200 bg-stone-50 shadow-md"
        aria-label="メニューを開く"
      >
        <HamburgerIcon />
      </button>

      {/* オーバーレイシート */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute bottom-0 inset-x-0 bg-stone-50 rounded-t-2xl shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="p-4 border-b border-neutral-200 flex items-center justify-between">
              <div className="font-medium">メニュー</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-sm text-neutral-600 hover:text-neutral-900"
                aria-label="閉じる"
              >
                閉じる
              </button>
            </div>
            <nav className="p-4 space-y-6">
              <div>
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
                  onClick={() => setOpen(false)}
                >
                  ALL
                </Link>
              </div>

              {groups.map((g) => (
                <section key={g}>
                  <h2 className="text-xs uppercase tracking-wide text-neutral-500 mb-2">
                    {GROUP_LABELS[g as keyof typeof GROUP_LABELS]}
                  </h2>
                  <ul className="grid grid-cols-2 gap-2">
                    {listSources(g as any).map((s) => (
                      <li key={s.slug}>
                        <Link
                          href={`/sources/${s.slug}`}
                          className="flex items-center gap-2 border border-neutral-200 rounded px-2 py-2 hover:bg-neutral-50"
                          onClick={() => setOpen(false)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {iconPath(s.slug) ? (
                            <img src={iconPath(s.slug)!} alt="" className="w-4 h-4 object-contain" />
                          ) : (
                            <span className="w-4 h-4 inline-block rounded-sm bg-neutral-300" aria-hidden />
                          )}
                          <span className="text-sm">{s.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </nav>
          </div>
        </div>
      )}
    </>
  );
}
