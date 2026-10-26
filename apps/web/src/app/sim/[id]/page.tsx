import { Suspense } from "react";
import { LoadingShell } from "@/components/LoadingShell";
import { SimLoader } from "@/components/SimLoader";

export default function SimPage() {
  return (
    <Suspense fallback={<LoadingShell />}>
      <SimLoader />
    </Suspense>
  );
}
