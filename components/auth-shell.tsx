import { Database } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function AuthShell({
  children,
  title = "Token Observatory",
  subtitle = "ccusage telemetry",
}: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
}) {
  return (
    <main className="grid min-h-svh place-items-center bg-[#fbfcfe] px-5 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mx-auto mb-6 flex w-fit items-center gap-3 text-slate-950"
        >
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
            <Database className="h-[18px] w-[18px]" />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em]">{title}</p>
            <p className="mt-0.5 text-[10px] text-slate-400">{subtitle}</p>
          </div>
        </Link>
        {children}
      </div>
    </main>
  );
}
