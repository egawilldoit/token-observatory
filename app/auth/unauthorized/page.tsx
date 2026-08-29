import Link from "next/link";

import { LogoutButton } from "@/components/logout-button";

export default function UnauthorizedPage() {
  return (
    <main className="grid min-h-svh place-items-center bg-[#071019] p-6 text-slate-100">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.04] p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
          Access denied
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">
          This account is not authorized.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Token Observatory only permits accounts listed in
          TOKEN_OBSERVATORY_ALLOWED_EMAILS.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <LogoutButton />
          <Link
            href="/"
            className="rounded-md border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/[0.05]"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
