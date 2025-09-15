"use client";
import React from "react";
import Link from "next/link";
import { GROUP_LABELS, listSources } from "@/lib/data";
import { useSearchParams, usePathname } from "next/navigation";
import { iconPath } from "@/lib/icons";

const GROUPS = ["development", "cloud", "libraries", "programming"] as const;

// アイコンは public/icons 配下のSVGを使用

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${collapsed ? "-rotate-90" : "rotate-90"}`}
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function useActive() {
  const pathname = usePathname();
  const sp = useSearchParams();
  const group = sp.get("group");
  return React.useMemo(() => ({ pathname, group }), [pathname, group]);
}

export default function Sidebar() {
  const { pathname, group } = useActive();
  const isHome = pathname === "/";
  const activeGroup = isHome ? (group || "") : "";
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    const init: Record<string, boolean> = {};
    // トップ（ALL）ではデフォルト閉じる
    for (const g of GROUPS) init[g] = true;
    setCollapsed(init);
  }, []);

  return (
    <aside className="hidden lg:block border-r border-neutral-200 min-h-[60vh]">
      <div className="p-4 space-y-6">
        <div className="space-y-4">
          <div>
            <Link
              href="/"
              className={`text-sm inline-flex items-center gap-2 px-3 py-1 rounded-full border ${isHome && !activeGroup ? "border-black" : "border-neutral-300"}`}
            >
              ALL
            </Link>
          </div>

          {GROUPS.map((g) => {
            const list = listSources(g as any);
            const isActiveGroup = isHome && activeGroup === g;
            const isCollapsed = collapsed[g] ?? false;
            return (
              <div key={g} className="space-y-2">
                <button
                  type="button"
                  onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
                  className={`w-full flex items-center justify-between text-left font-medium text-neutral-800 ${isActiveGroup ? "opacity-100" : "opacity-70"}`}
                >
                  <span className="text-xs uppercase tracking-wide">
                    {GROUP_LABELS[g as keyof typeof GROUP_LABELS]}
                  </span>
                  <Chevron collapsed={isCollapsed} />
                </button>
                {!isCollapsed && (
                  <ul className="space-y-1">
                    {list.map((s) => {
                      const href = `/sources/${s.slug}`;
                      const active = pathname === href;
                      return (
                        <li key={s.slug}>
                          <Link
                            href={href}
                            className={`flex items-center gap-2 px-2 py-1 rounded border ${active ? "border-black" : "border-transparent hover:border-neutral-300"}`}
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
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
