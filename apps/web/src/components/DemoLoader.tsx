"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { DemoBundle } from "@/lib/types";
import { Workspace } from "./Workspace";
import { LoadingShell } from "./LoadingShell";

export function DemoLoader() {
  const { slug } = useParams<{ slug: string }>();
  const [bundle, setBundle] = useState<DemoBundle | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch(`/demo/${slug}.json`).then((r) => (r.ok ? r.json() : Promise.reject())).then(setBundle).catch(() => setMissing(true));
  }, [slug]);
  if (missing) return <LoadingShell message="That demo doesn’t exist." />;
  if (!bundle) return <LoadingShell />;
  return <Workspace initial={bundle.simulation} liveId={null} demo={bundle} messages={bundle.messages} />;
}
