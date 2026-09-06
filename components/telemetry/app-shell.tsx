"use client";

import {
  Activity,
  Database,
  Gauge,
  Laptop,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { LogoutButton } from "@/components/logout-button";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: Activity },
  { href: "/opencode-go", label: "OpenCode Go", icon: Gauge },
  { href: "/imports", label: "Imports", icon: UploadCloud },
  { href: "/machines", label: "Machines", icon: Laptop },
];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#fbfcfe] text-slate-950">
      <div className="flex min-h-screen w-full">
        <aside className="sticky top-0 hidden h-screen w-[220px] shrink-0 border-r border-slate-200/80 bg-white px-4 py-6 lg:flex lg:flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 px-1">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-blue-600 text-white shadow-sm shadow-blue-200">
              <Database className="h-[18px] w-[18px]" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold tracking-[-0.025em] text-slate-950">
                Token Observatory
              </p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                usage telemetry
              </p>
            </div>
          </Link>

          <nav aria-label="Primary" className="mt-10 space-y-1.5">
            {navigation.map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={[
                    "flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] font-medium transition",
                    active
                      ? "bg-blue-50 text-blue-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950",
                  ].join(" ")}
                >
                  <Icon
                    className={active ? "h-4 w-4 text-blue-600" : "h-4 w-4 text-slate-500"}
                    strokeWidth={2}
                  />
                  {item.label}
                  {active ? (
                    <span
                      aria-hidden="true"
                      className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-600"
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto">
            <LogoutButton compact />
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden bg-[#fbfcfe] px-4 py-5 sm:px-6 lg:px-8 lg:py-7 xl:px-9">
          <div className="mb-5 flex min-w-0 items-center gap-2 overflow-x-auto pb-1 lg:hidden">
            <div className="mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-blue-600 text-white">
              <Database className="h-4 w-4" />
            </div>
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
                      "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium transition",
                      active
                        ? "border-blue-200 bg-blue-50 text-blue-700"
                        : "border-slate-200 bg-white text-slate-600",
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
