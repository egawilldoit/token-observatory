import { DatabaseZap, KeyRound, TerminalSquare } from "lucide-react";

export function SetupRequired() {
  return (
    <div className="mx-auto max-w-3xl rounded-3xl border border-white/10 bg-white/[0.035] p-6 md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300">
          <DatabaseZap className="h-6 w-6" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
            One-time setup
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Connect the telemetry database
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            The application code is ready, but server-side telemetry stays disabled
            until the Supabase migration and secret are configured.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <TerminalSquare className="mb-3 h-5 w-5 text-violet-300" />
          <p className="font-medium">Apply the migration</p>
          <code className="mt-2 block break-all text-xs leading-5 text-slate-400">
            supabase/migrations/20260829_001_ccusage_v1.sql
          </code>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <KeyRound className="mb-3 h-5 w-5 text-emerald-300" />
          <p className="font-medium">Configure server secrets</p>
          <code className="mt-2 block text-xs leading-5 text-slate-400">
            NEXT_PUBLIC_SUPABASE_URL
            <br />
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            <br />
            SUPABASE_SECRET_KEY
          </code>
        </div>
      </div>
    </div>
  );
}
