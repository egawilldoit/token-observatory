import {
  ArrowRight,
  Database,
  Fingerprint,
  LineChart,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";

const features = [
  {
    icon: UploadCloud,
    title: "Snapshot ingestion",
    text: "Upload pinned ccusage JSON and preserve the raw evidence in Supabase Storage.",
  },
  {
    icon: Fingerprint,
    title: "Idempotent dedupe",
    text: "Exact file hashes and per-day usage hashes prevent overlapping snapshots from inflating totals.",
  },
  {
    icon: LineChart,
    title: "Current truth",
    text: "The dashboard reads only the latest accepted observation for each machine × agent × day.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#071019] text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_75%_0%,rgba(34,211,238,0.10),transparent_35%),radial-gradient(circle_at_15%_55%,rgba(139,92,246,0.07),transparent_30%)]" />
      <div className="relative mx-auto max-w-6xl px-5 py-7 md:px-8">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold">Token Observatory</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-600">
                ccusage telemetry
              </p>
            </div>
          </div>
          <Link
            href="/auth/login"
            className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.08]"
          >
            Sign in
          </Link>
        </nav>

        <section className="grid items-center gap-12 py-20 md:py-28 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <div className="inline-flex rounded-full border border-cyan-400/20 bg-cyan-400/[0.06] px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.16em] text-cyan-200">
              Multi-machine AI usage
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.055em] md:text-7xl">
              One source of truth for every token you burn.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-400">
              Collect ccusage snapshots from your VM and PCs, deduplicate overlap
              safely, and inspect daily token consumption from one Supabase-backed
              dashboard.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200"
              >
                Open observatory
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/imports"
                className="rounded-xl border border-white/10 bg-white/[0.035] px-5 py-3 text-sm font-medium text-slate-300 transition hover:bg-white/[0.07]"
              >
                Import usage
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 shadow-2xl shadow-black/20">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-slate-600">
                  Canonical pipeline
                </p>
                <p className="mt-1 text-sm font-medium">Absolute observations</p>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,.5)]" />
            </div>
            <div className="mt-5 space-y-3">
              {[
                ["01", "Upload", "Raw JSON → immutable Storage"],
                ["02", "Fingerprint", "SHA-256 + daily usage hashes"],
                ["03", "Diff", "New · revised · unchanged"],
                ["04", "Promote", "Atomic Postgres observation write"],
                ["05", "Visualize", "Latest accepted daily truth"],
              ].map(([step, label, detail]) => (
                <div
                  key={step}
                  className="grid grid-cols-[36px_90px_1fr] items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/15 px-3 py-3"
                >
                  <span className="font-mono text-[10px] text-slate-600">{step}</span>
                  <span className="text-sm font-medium text-slate-300">{label}</span>
                  <span className="text-xs text-slate-500">{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 border-t border-white/10 py-8 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="p-4">
                <Icon className="h-5 w-5 text-slate-500" />
                <h2 className="mt-4 font-medium">{feature.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {feature.text}
                </p>
              </div>
            );
          })}
        </section>
      </div>
    </main>
  );
}
