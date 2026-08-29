"use client";

import {
  Activity,
  Database,
  Laptop,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: Activity },
  { href: "/imports", label: "Imports", icon: UploadCloud },
  { href: "/machines", label: "Machines", icon: Laptop },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#071019] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_75%_-10%,rgba(34,211,238,0.09),transparent_35%),radial-gradient(circle_at_15%_45%,rgba(139,92,246,0.06),transparent_30%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-[1600px]">
        <aside className="hidden w-64 shrink-0 border-r border-white/10 px-5 py-7 lg:block">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold tracking-tight">Token Observatory</p>
              <p className="text-[11px] text-slate-500">ccusage telemetry</p>
            </div>
          </Link>

          <nav aria-label="Primary" className="mt-10 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-white/[0.07] text-white"
                      : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                  ].join(" ")}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-cyan-300"
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="absolute bottom-7 w-[216px] border-t border-white/10 pt-4">
            <p className="mb-3 text-xs leading-5 text-slate-500">
              Absolute observations.
              <br />
              Latest accepted row wins.
            </p>
            <LogoutButton compact />
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-1 lg:hidden">
            <nav aria-label="Primary" className="flex gap-2">
              {navigation.map((item) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={[
                      "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs",
                      active
                        ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100"
                        : "border-white/10 bg-white/[0.03] text-slate-400",
                    ].join(" ")}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="ml-auto shrink-0">
              <LogoutButton compact />
            </div>
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
