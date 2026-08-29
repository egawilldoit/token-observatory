"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileJson2,
  Loader2,
  Terminal,
  UploadCloud,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type MachineHint = {
  id: string;
  name: string;
  lastUsageDate: string | null;
  nextSince: string | null;
  command: string;
};

type ImportResponse = {
  status: "processed" | "exact_duplicate";
  importId: string;
  duplicateOfImportId?: string;
  crossMachineMatch?: boolean;
  summary?: {
    new: number;
    revised: number;
    unchanged: number;
    beforeTotal: number;
    afterTotal: number;
    netChange: number;
    agents: string[];
    scopeStart: string;
    scopeEnd: string;
    warnings: string[];
  };
  nextCommand?: string;
};

function compact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return sign + (abs / 1_000_000_000).toFixed(2) + "B";
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + "M";
  return value.toLocaleString();
}

export function ImportPanel({ machines }: { machines: MachineHint[] }) {
  const router = useRouter();
  const [machineId, setMachineId] = useState(machines[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () => machines.find((machine) => machine.id === machineId) ?? null,
    [machineId, machines],
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !machineId || !selected) return;

    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const form = new FormData();
      form.set("machine_id", machineId);
      form.set("file", file);
      form.set("command_used", selected.command);

      const response = await fetch("/api/imports", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "Import failed.");
      }

      setResult(payload as ImportResponse);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  if (machines.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center">
        <AlertTriangle className="mx-auto h-7 w-7 text-amber-300" />
        <h2 className="mt-4 text-lg font-semibold">Register a machine first</h2>
        <p className="mt-2 text-sm text-slate-500">
          Uploads deliberately use a controlled machine identity rather than free
          text.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
      <form
        onSubmit={submit}
        className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-cyan-300">
            <UploadCloud className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">Upload snapshot</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              JSON is an absolute observation. Existing overlap is compared, never
              added.
            </p>
          </div>
        </div>

        <label className="mt-6 block text-xs font-medium text-slate-400">
          Machine
          <select
            value={machineId}
            onChange={(event) => {
              setMachineId(event.target.value);
              setResult(null);
            }}
            className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#0a1620] px-3 text-sm text-slate-200 outline-none ring-cyan-400 focus:ring-1"
          >
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block text-xs font-medium text-slate-400">
          ccusage JSON
          <span className="mt-2 flex min-h-28 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-black/15 px-4 text-center transition hover:border-cyan-400/30 hover:bg-cyan-400/[0.03]">
            <FileJson2 className="h-6 w-6 text-slate-500" />
            <span className="mt-2 text-sm text-slate-300">
              {file ? file.name : "Choose ccusage.json"}
            </span>
            <span className="mt-1 text-[11px] text-slate-600">
              {file
                ? (file.size / 1024 / 1024).toFixed(2) + " MB"
                : "Maximum 8 MB · raw file is preserved"}
            </span>
            <input
              className="sr-only"
              type="file"
              accept=".json,application/json,text/plain"
              required
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setResult(null);
              }}
            />
          </span>
        </label>

        <button
          type="submit"
          disabled={!file || busy}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 text-sm font-semibold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Processing snapshot
            </>
          ) : (
            "Import and deduplicate"
          )}
        </button>

        {error ? (
          <div className="mt-4 rounded-xl border border-red-400/20 bg-red-400/[0.07] p-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}
      </form>

      <div className="space-y-4">
        <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5 md:p-6">
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-5 w-5 text-violet-300" />
            <div className="min-w-0">
              <h2 className="font-semibold">Recommended collection command</h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected?.lastUsageDate
                  ? "Three-day overlap from the latest accepted usage date."
                  : "First import uses full available history."}
              </p>
            </div>
          </div>
          <pre className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/25 p-4 text-xs leading-6 text-slate-300">
            {selected?.command}
          </pre>
          {selected?.lastUsageDate ? (
            <p className="mt-3 text-[11px] text-slate-600">
              Latest accepted date: {selected.lastUsageDate} · next since:{" "}
              {selected.nextSince}
            </p>
          ) : null}
        </div>

        {result ? (
          <div className="rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-5 md:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-300" />
              <div>
                <p className="font-semibold">
                  {result.status === "exact_duplicate"
                    ? "Exact duplicate skipped"
                    : "Import processed"}
                </p>
                <p className="mt-1 text-xs text-emerald-100/50">
                  Import {result.importId.slice(0, 8)}
                </p>
              </div>
            </div>

            {result.summary ? (
              <>
                <div className="mt-5 grid grid-cols-3 gap-2">
                  {[
                    ["New", result.summary.new],
                    ["Revised", result.summary.revised],
                    ["Unchanged", result.summary.unchanged],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-xl border border-white/10 bg-black/15 p-3"
                    >
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">
                        {label}
                      </p>
                      <p className="mt-1 text-xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <span className="text-slate-500">
                    Before{" "}
                    <b className="text-slate-200">
                      {compact(result.summary.beforeTotal)}
                    </b>
                  </span>
                  <span className="text-slate-500">
                    After{" "}
                    <b className="text-slate-200">
                      {compact(result.summary.afterTotal)}
                    </b>
                  </span>
                  <span className="text-slate-500">
                    Net{" "}
                    <b
                      className={
                        result.summary.netChange >= 0
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      {result.summary.netChange >= 0 ? "+" : ""}
                      {compact(result.summary.netChange)}
                    </b>
                  </span>
                </div>
              </>
            ) : null}

            {result.crossMachineMatch ? (
              <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-3 text-xs leading-5 text-amber-100/80">
                The same raw dataset has appeared on another machine. V1 keeps
                provenance and flags it; it does not silently merge machines.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
