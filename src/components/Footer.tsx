import React from "react";
import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200 mt-16">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-10 text-sm text-neutral-600">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p>&copy; {new Date().getFullYear()} TechSnap</p>
          <div className="flex gap-4">
            <Link href="/" className="hover:text-neutral-900">ホーム</Link>
            <Link href="/sources" className="hover:text-neutral-900">ソース</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
