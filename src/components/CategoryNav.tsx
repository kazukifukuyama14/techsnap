"use client";
import React from "react";
import Link from "next/link";
import { categories } from "@/lib/data";

export default function CategoryNav({ className = "" }: { className?: string }) {
  return (
    <div className={`border-t border-neutral-200 ${className}`}>
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 overflow-x-auto">
        <nav className="flex gap-4 sm:gap-6 py-3 text-sm whitespace-nowrap">
          {categories.map((c) => (
            <Link
              key={c.slug}
              href={`/categories/${c.slug}`}
              className="text-neutral-600 hover:text-neutral-900 transition-colors"
            >
              {c.name}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}

