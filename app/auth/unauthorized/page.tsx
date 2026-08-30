import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { AuthShell } from "@/components/auth-shell";
import { LogoutButton } from "@/components/logout-button";

export default function UnauthorizedPage() {
  return (
    <AuthShell>
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.025),0_18px_50px_rgba(15,23,42,0.05)]">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-amber-600">
          Access denied
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-slate-950">
          This account is not authorized.
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-500">
          Token Observatory only permits accounts listed in
          TOKEN_OBSERVATORY_ALLOWED_EMAILS.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <LogoutButton />
          <Link
            href="/"
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm hover:border-blue-200 hover:text-blue-700"
          >
            Home
          </Link>
        </div>
      </div>
    </AuthShell>
  );
}
