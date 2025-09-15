import React from "react";
import Link from "next/link";

export default function Header({ brandName }: { brandName: string }) {
  return (
    <header className="border-b border-neutral-200">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          {brandName}
        </Link>
        {/* right-side nav removed as requested */}
      </div>
    </header>
  );
}
