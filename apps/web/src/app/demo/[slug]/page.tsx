import { Suspense } from "react";
import { DemoLoader } from "@/components/DemoLoader";
import { LoadingShell } from "@/components/LoadingShell";

export default function DemoPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <DemoLoader />
    </Suspense>
  );
}
