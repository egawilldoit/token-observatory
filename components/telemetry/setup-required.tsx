import { DatabaseZap, KeyRound, TerminalSquare } from "lucide-react";

export function SetupRequired() {
  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.025)] md:p-8">
      <div className="mb-6 flex items-start gap-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
          <DatabaseZap className="h-5 w-5" />
        </div>
        <div>
          <p className="obs-kicker">One-time setup</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em] text-slate-950">
            Connect the telemetry database
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Server-side telemetry stays disabled until Supabase, the migrations,
            and an explicit account allowlist are configured.
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <TerminalSquare className="mb-3 h-5 w-5 text-violet-600" />
          <p className="font-medium text-slate-900">Apply the migrations</p>
          <code className="mt-2 block break-all text-xs leading-5 text-slate-500">
            supabase/migrations/20260829_001_ccusage_v1.sql
          </code>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
          <KeyRound className="mb-3 h-5 w-5 text-emerald-600" />
          <p className="font-medium text-slate-900">Configure server access</p>
          <code className="mt-2 block text-xs leading-5 text-slate-500">
            NEXT_PUBLIC_SUPABASE_URL
            <br />
            NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
            <br />
            SUPABASE_SECRET_KEY
            <br />
            TOKEN_OBSERVATORY_ALLOWED_EMAILS
          </code>
        </div>
      </div>
    </div>
  );
}
