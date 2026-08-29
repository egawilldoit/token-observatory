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
    <div className="min-h-screen overflow-x-hidden bg-[#071019] text-slate-100">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_78%_-12%,rgba(34,211,238,0.08),transparent_34%),radial-gradient(circle_at_12%_48%,rgba(139,92,246,0.05),transparent_28%)]" />
      <div className="relative flex min-h-screen w-full">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-white/[0.08] bg-[#07111b]/85 px-4 py-6 backdrop-blur lg:flex lg:flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 px-1">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <Database className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-semibold tracking-tight">Token Observatory</p>
              <p className="text-[11px] text-slate-500">ccusage telemetry</p>
            </div>
          </Link>

          <nav aria-label="Primary" className="mt-9 space-y-1">
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
                      ? "bg-white/[0.075] text-white"
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

          <div className="mt-auto border-t border-white/[0.08] pt-4">
            <div className="mb-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3 py-2.5">
              <p className="text-[11px] leading-5 text-slate-500">
                Absolute observations.
                <br />
                Latest accepted row wins.
              </p>
            </div>
            <LogoutButton compact />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 sm:px-6 lg:px-7 lg:py-7 xl:px-8">
          <div className="mb-5 flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:hidden">
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
          <div className="mx-auto min-w-0 max-w-[1500px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
