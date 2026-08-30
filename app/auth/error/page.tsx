import { AlertCircle } from "lucide-react";
import { Suspense } from "react";

import { AuthShell } from "@/components/auth-shell";

async function ErrorContent({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  const params = await searchParams;

  return (
    <p className="mt-3 text-sm leading-6 text-slate-500">
      {params?.error
        ? "Code error: " + params.error
        : "An unspecified authentication error occurred."}
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ error: string }>;
}) {
  return (
    <AuthShell>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.025),0_18px_50px_rgba(15,23,42,0.05)]">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-600">
          <AlertCircle className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
          Sorry, something went wrong.
        </h1>
        <Suspense fallback={<p className="mt-3 text-sm text-slate-400">Loading error details…</p>}>
          <ErrorContent searchParams={searchParams} />
        </Suspense>
      </div>
    </AuthShell>
  );
}
