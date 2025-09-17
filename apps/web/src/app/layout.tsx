import "./globals.css";
import { Inter, Noto_Serif_JP } from "next/font/google";
import React from "react";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Sidebar from "@/components/Sidebar";
import MobileMenu from "@/components/MobileMenu";

const inter = Inter({ subsets: ["latin"], display: "swap" });
// CJK フォントは subset 指定ができないためプリロードを無効化
const notoSerif = Noto_Serif_JP({ display: "swap", preload: false, weight: ["400", "600", "700"] });

export const metadata = {
  title: "TechSnap",
  description: "TechSnap Application",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className={`${inter.className} antialiased bg-stone-100 text-neutral-900`}>
        <Header brandName="TechSnap" />
        <main className="mx-auto px-0 lg:px-0 py-8 min-h-[60vh]">
          <div className="grid grid-cols-1 lg:grid-cols-[280px,1fr] gap-8">
            <Sidebar />
            <div className={`${notoSerif.className} container mx-auto px-4 sm:px-6 lg:px-8`}>{children}</div>
          </div>
        </main>
        <MobileMenu />
        <Footer />
      </body>
    </html>
  );
}
