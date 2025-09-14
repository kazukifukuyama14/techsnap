"use client";
import React from "react";
import Link from "next/link";
import { GROUP_LABELS, listSources } from "@/lib/data";
import { useSearchParams, usePathname } from "next/navigation";

const GROUPS = ["development", "cloud", "libraries", "programming"] as const;

// アイコンは public/icons 配下のSVGを使用
export const iconForSource: Record<string, string> = {
  "argo-cd": "/icons/argo.svg",
  circleci: "/icons/circleci.svg",
  github: "/icons/github.svg",
  gitlab: "/icons/gitlab.svg",
  docker: "/icons/docker.svg",
  aws: "/icons/aws.svg",
  azure: "/icons/azure.svg",
  firebase: "/icons/firebase.svg",
  gcp: "/icons/google_cloud.svg",
  kubernetes: "/icons/kubernetes.svg",
  terraform: "/icons/terraform.svg",
  nextjs: "/icons/nextjs.svg",
  nuxt: "/icons/nuxtjs.svg",
  rails: "/icons/rails.svg",
  react: "/icons/reactjs.svg",
  vue: "/icons/vuejs.svg",
  go: "/icons/golang.svg",
  nodejs: "/icons/nodejs.svg",
  python: "/icons/python.svg",
  ruby: "/icons/ruby.svg",
  rust: "/icons/rust.svg",
  typescript: "/icons/typescript.svg",
};

function Chevron({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      className={"transition-transform " + (collapsed ? "-rotate-90" : "rotate-0")}
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export default function Sidebar() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const activeGroup = (searchParams.get("group") ?? undefined) as any;
  const currentSourceSlug = pathname?.startsWith("/sources/") ? pathname.split("/")[2] : undefined;

  // 折り畳み状態を保持（ローカルストレージ永続化）
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({});
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem("sidebar-collapsed");
      if (saved) setCollapsed(JSON.parse(saved));
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem("sidebar-collapsed", JSON.stringify(collapsed));
    } catch {}
  }, [collapsed]);

  const toggle = (g: string) => setCollapsed((s) => ({ ...s, [g]: !s[g] }));

  const onAll = pathname === "/" && !activeGroup;

  return (
    <aside className="hidden lg:block pr-4">
      <div className="sticky top-14 h-[calc(100vh-56px)] overflow-y-auto py-6 border-r border-neutral-200">
        <nav className="px-3 space-y-6">
          {/* ALL ボタン */}
          <div>
            <Link
              href="/"
              className={
                onAll
                  ? "inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-900 text-white"
                  : "inline-flex items-center gap-2 px-3 py-1 rounded-full border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              }
            >
              <span className="text-sm">ALL</span>
            </Link>
          </div>

          {GROUPS.map((g) => {
            const label = GROUP_LABELS[g as keyof typeof GROUP_LABELS];
            const sources = listSources(g as any);
            const groupActive = activeGroup === g;
            const isCollapsed = !!collapsed[g];
            return (
              <div key={g}>
                <div className="mb-2 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => toggle(g)}
                    className={`flex items-center gap-2 text-xs uppercase tracking-wide ${
                      groupActive ? "text-neutral-900" : "text-neutral-500 hover:text-neutral-800"
                    }`}
                    aria-expanded={!isCollapsed}
                    aria-controls={`group-${g}`}
                  >
                    <Chevron collapsed={isCollapsed} />
                    {label}
                  </button>
                </div>
                <ul id={`group-${g}`} className={isCollapsed ? "hidden" : "space-y-1"}>
                  {sources.map((s) => {
                    const active = currentSourceSlug === s.slug;
                    return (
                      <li key={s.slug}>
                        <Link
                          href={`/sources/${s.slug}`}
                          className={
                            active
                              ? "flex items-center gap-2 rounded px-2 py-1 bg-neutral-900 text-white"
                              : "flex items-center gap-2 rounded px-2 py-1 hover:bg-neutral-50 text-neutral-700"
                          }
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {iconForSource[s.slug] ? (
                            <img src={iconForSource[s.slug]} alt="" className="w-4 h-4 object-contain" />
                          ) : (
                            <span className="w-4 h-4 inline-block rounded-sm bg-neutral-300" aria-hidden />
                          )}
                          <span>{s.name}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
