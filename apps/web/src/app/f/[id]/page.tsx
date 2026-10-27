import { connection } from "next/server";
import { Suspense } from "react";
import { LoadingShell } from "@/components/LoadingShell";
import { SharePage } from "@/components/SharePage";

export const metadata = {
  title: "Which life would you pick?",
  description: "A friend simulated two futures with Elsewhere. Look at both and vote on which life they should choose.",
  twitter: { card: "summary_large_image" },
};

/** Marks this page as request-time, so its per-link preview image (opengraph-image) can be generated. */
async function RequestTime() {
  await connection();
  return null;
}

export default function SharedFork() {
  return (
    <>
      <Suspense fallback={null}>
        <RequestTime />
      </Suspense>
      <Suspense fallback={<LoadingShell />}>
        <SharePage />
      </Suspense>
    </>
  );
}
