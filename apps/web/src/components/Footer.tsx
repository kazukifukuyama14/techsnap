import React from "react";

export default function Footer() {
  return (
    <footer className="border-t border-neutral-200">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-6 text-sm text-neutral-600">
        © {new Date().getFullYear()} TechSnap
      </div>
    </footer>
  );
}
