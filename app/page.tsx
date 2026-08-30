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
    text: "Exact-file dedupe plus immutable daily revisions prevent overlapping snapshots from inflating totals.",
  },
  {
    icon: LineChart,
    title: "Current truth",
    text: "The dashboard reads only the latest accepted observation for each machine × agent × day.",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[#fbfcfe] text-slate-950">
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-8">
        <nav className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-600 text-white shadow-sm shadow-blue-200">
              <Database className="h-[18px] w-[18px]" />
            </div>
            <div>
              <p className="font-semibold tracking-[-0.02em]">Token Observatory</p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                ccusage telemetry
              </p>
            </div>
          </div>
          <Link
            href="/auth/login"
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
          >
            Sign in
          </Link>
        </nav>

        <section className="grid items-center gap-12 py-20 md:py-28 lg:grid-cols-[1.06fr_.94fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">
              Multi-machine AI usage
            </p>
            <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.055em] text-slate-950 md:text-7xl">
              One source of truth for every token you burn.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-slate-500">
              Collect ccusage snapshots from your VM and PCs, deduplicate overlap
              safely, and inspect daily token consumption from one Supabase-backed
              dashboard.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
              >
                Open observatory
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/imports"
                className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:border-blue-200 hover:text-blue-700"
              >
                Import usage
              </Link>
            </div>
          </div>

          <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_20px_60px_rgba(15,23,42,0.05)]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Canonical pipeline
                </p>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  Absolute observations
                </p>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            <div className="mt-5 space-y-2.5">
              {[
                ["01", "Upload", "Raw JSON → immutable Storage"],
                ["02", "Fingerprint", "SHA-256 + daily usage hashes"],
                ["03", "Diff", "New · revised · removed · unchanged"],
                ["04", "Promote", "Atomic Postgres observation write"],
                ["05", "Visualize", "Latest accepted daily truth"],
              ].map(([step, label, detail]) => (
                <div
                  key={step}
                  className="grid grid-cols-[36px_90px_1fr] items-center gap-3 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-3"
                >
                  <span className="font-mono text-[10px] text-slate-400">{step}</span>
                  <span className="text-sm font-medium text-slate-800">{label}</span>
                  <span className="text-xs text-slate-500">{detail}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="grid gap-3 border-t border-slate-200 py-9 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="rounded-2xl p-4">
                <div className="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <Icon className="h-4 w-4" />
                </div>
                <h2 className="mt-4 font-semibold text-slate-900">{feature.title}</h2>
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
