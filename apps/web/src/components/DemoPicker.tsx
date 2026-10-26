"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Item { slug: string; title: string; blurb: string; mode: string }

export function DemoPicker() {
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    fetch("/demo/index.json").then((r) => r.json()).then(setItems).catch(() => setItems([]));
  }, []);
  if (!items) return <div className="h-40 animate-pulse rounded-2xl bg-raised" />;
  return (
    <ul className="grid gap-4 md:grid-cols-3">
      {items.map((d) => (
        <li key={d.slug}>
          <Link href={`/demo/${d.slug}`} className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-raised p-6 transition hover:border-line-2">
            <span className="font-display text-[24px] leading-tight">{d.title}</span>
            <span className="text-[15px] leading-relaxed text-soft">{d.blurb}</span>
            <span className="mt-auto pt-2 text-[14px] text-path-a">Open both worlds →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
