"use client";
import React from "react";
import Link from "next/link";

type Props = {
  brandName: string;
};

export default function Header({ brandName }: Props) {
  return (
    <header className="sticky top-0 z-40 border-b border-neutral-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between">
          <Link href="/" className="font-semibold tracking-tight text-xl">
            {brandName}
          </Link>
        </div>
      </div>
    </header>
  );
}
