"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  FileJson2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type MachineHint = {
  id: string;
  name: string;
  lastAcceptedScopeEnd: string | null;
  nextSince: string | null;
  command: string;
  sessionEvidenceCount: number;
  mirrorFingerprintCount: number;
  lastSessionEvidenceAt: string | null;
};

type ImportResponse = {
  status: "processed" | "exact_duplicate";
  importId: string;
  requestId?: string;
  duplicateOfImportId?: string;
  duplicateOfMachineId?: string;
  crossMachineMatch?: boolean;
  modelBackfilled?: number;
  sessionBackfilled?: number;
  sessionEvidenceCount?: number;
  models?: string[];
  summary?: {
    new: number;
    revised: number;
    removed: number;
    unchanged: number;
    beforeTotal: number;
    afterTotal: number;
    netChange: number;
    agents: string[];
    scopeStart: string;
    scopeEnd: string;
    warnings: string[];
    sessionEvidence?: {
      imported: number;
      exactCrossMachineMatches: number;
      identityCrossMachineMatches: number;
      partialMirrorRisk: boolean;
    };
    globalDedupe?: {
      rowsSuppressed: number;
      duplicateTokensPrevented: number;
    };
  };
  nextCommand?: string;
};

function compact(value: number) {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return sign + (abs / 1_000_000_000).toFixed(2) + "B";
  }
  if (abs >= 1_000_000) {
    return sign + (abs / 1_000_000).toFixed(1) + "M";
  }
  return value.toLocaleString();
}

async function readJsonResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    throw new Error(
      "Import returned an empty response (HTTP " + response.status + ").",
    );
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(
      "Import returned a non-JSON response (HTTP " +
        response.status +
        "). Please check Vercel logs.",
    );
  }
}

export function ImportPanel({ machines }: { machines: MachineHint[] }) {
  const router = useRouter();
  const [machineId, setMachineId] = useState(() => machines[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = useMemo(
    () =>
      machines.find((machine) => machine.id === machineId) ??
      machines[0] ??
      null,
    [machineId, machines],
  );

  const effectiveMachineId = selected?.id ?? "";

  useEffect(() => {
    if (selected && machineId !== selected.id) {
      setMachineId(selected.id);
    }
  }, [machineId, selected]);

  async function copyCommand() {
    if (!selected?.command) return;

    try {
      await navigator.clipboard.writeText(selected.command);
      setCommandCopied(true);
      window.setTimeout(() => setCommandCopied(false), 1600);
    } catch {
      setError("Could not copy the collection command.");
    }
  }

  async function backfillSessionEvidence() {
    if (!selected) return;

    setEvidenceBusy(true);
    setEvidenceMessage(null);
    setError(null);

    try {
      const response = await fetch("/api/sessions/backfill", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ machineId: selected.id }),
      });
      const payload = (await response.json()) as {
        error?: string;
        insertedSessionRows?: number;
        parsedSessionRows?: number;
        warnings?: string[];
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Session evidence backfill failed.");
      }

      setEvidenceMessage(
        "Loaded " +
          Number(payload.insertedSessionRows ?? 0).toLocaleString() +
          " new session fingerprints from " +
          Number(payload.parsedSessionRows ?? 0).toLocaleString() +
          " parsed session rows.",
      );
      router.refresh();
    } catch (caught) {
      setEvidenceMessage(
        caught instanceof Error
          ? caught.message
          : "Session evidence backfill failed.",
      );
    } finally {
      setEvidenceBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!file) {
      setError("Choose a ccusage JSON file before importing.");
      return;
    }

    if (!selected || !effectiveMachineId) {
      setError("No valid machine is selected. Reload the page and try again.");
      return;
    }

    setBusy(true);
    setStatusText("Uploading " + (file.size / 1024 / 1024).toFixed(2) + " MB…");
    setError(null);
    setResult(null);

    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 90_000);

    try {
      const form = new FormData();
      form.set("machine_id", effectiveMachineId);
      form.set("file", file);
      form.set("command_used", selected.command ?? "");

      const response = await fetch("/api/imports", {
        method: "POST",
        body: form,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "X-Observatory-Request-Id": requestId,
        },
      });

      setStatusText("Processing server response…");
      const payload = await readJsonResponse(response);

      if (!response.ok) {
        const message =
          typeof payload.error === "string" ? payload.error : "Import failed.";
        const responseRequestId =
          typeof payload.requestId === "string" ? payload.requestId : requestId;

        throw new Error(
          message +
            " (HTTP " +
            response.status +
            ", request " +
            responseRequestId +
            ")",
        );
      }

      setResult(payload as ImportResponse);
      setFile(null);
      setStatusText(null);
      router.refresh();
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setError(
          "Import timed out after 90 seconds. Request ID: " +
            requestId +
            ". Check Vercel logs before retrying.",
        );
      } else {
        setError(caught instanceof Error ? caught.message : "Import failed.");
      }
      setStatusText(null);
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  }

  if (machines.length === 0) {
    return (
      <div className="obs-card border-dashed p-8 text-center">
        <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-amber-50 text-amber-600">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-950">
          Register a machine first
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          Uploads use a controlled machine identity rather than free text.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
      <form onSubmit={submit} className="obs-card p-5 md:p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <UploadCloud className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-950">Upload snapshot</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              JSON is an absolute observation. Existing overlap is compared,
              never added.
            </p>
          </div>
        </div>

        <label className="mt-6 block text-xs font-medium text-slate-600">
          Machine
          <select
            value={effectiveMachineId}
            onChange={(event) => {
              setMachineId(event.target.value);
              setResult(null);
              setError(null);
            }}
            className="obs-control mt-2 w-full"
          >
            {machines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.name}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-5 block text-xs font-medium text-slate-600">
          ccusage JSON
          <span className="mt-2 flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-slate-50/70 px-4 text-center transition hover:border-blue-300 hover:bg-blue-50/40">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200">
              <FileJson2 className="h-5 w-5" />
            </span>
            <span className="mt-3 text-sm font-medium text-slate-700">
              {file ? file.name : "Choose ccusage.json"}
            </span>
            <span className="mt-1 text-[11px] text-slate-400">
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
                setError(null);
              }}
            />
          </span>
        </label>

        <button
          type="submit"
          disabled={!file || !selected || !effectiveMachineId || busy}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {statusText ?? "Processing snapshot…"}
            </>
          ) : (
            "Import and deduplicate"
          )}
        </button>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm leading-5 text-red-700"
          >
            {error}
          </div>
        ) : null}
      </form>

      <div className="space-y-5">
        <div className="obs-card p-5 md:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <Terminal className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-950">
                Recommended collection command
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {selected?.lastAcceptedScopeEnd
                  ? "Three-day overlap from the latest accepted import scope."
                  : "First import uses full available history."}
              </p>
            </div>
          </div>

          <div className="mt-4 flex min-w-0 items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-[11px] leading-5 text-slate-700">
              {selected?.command ||
                "Collection command unavailable — reload after selecting a machine."}
            </code>
            <button
              type="button"
              onClick={copyCommand}
              disabled={!selected?.command}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:border-blue-200 hover:text-blue-700 disabled:opacity-40"
            >
              <Copy className="h-3.5 w-3.5" />
              {commandCopied ? "Copied" : "Copy"}
            </button>
          </div>

          {selected?.lastAcceptedScopeEnd ? (
            <p className="mt-3 text-[11px] text-slate-400">
              Latest accepted scope end:{" "}
              <span className="font-medium text-slate-600">
                {selected.lastAcceptedScopeEnd}
              </span>
              {" · "}next since:{" "}
              <span className="font-medium text-emerald-600">
                {selected.nextSince}
              </span>
            </p>
          ) : null}
        </div>

        <div className="obs-card p-5 md:p-6">
          <div className="flex items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <ShieldCheck className="h-4 w-4" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-950">
                Dedupe protection
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                Per-machine truth stays intact. Proven mirrors are removed only
                from all-machines totals.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {[
              ["Exact file", "Protected"],
              ["Daily overlap", "Protected"],
              ["Model overlap", "Protected"],
              [
                "Cross-machine sessions",
                selected?.sessionEvidenceCount
                  ? selected.sessionEvidenceCount.toLocaleString() + " fingerprints"
                  : "Evidence not loaded",
              ],
            ].map(([label, value]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5"
              >
                <span className="text-xs text-slate-500">{label}</span>
                <span
                  className={
                    "text-xs font-medium " +
                    (value === "Evidence not loaded"
                      ? "text-amber-700"
                      : "text-emerald-700")
                  }
                >
                  {value}
                </span>
              </div>
            ))}
          </div>

          {!selected?.sessionEvidenceCount ? (
            <button
              type="button"
              onClick={backfillSessionEvidence}
              disabled={evidenceBusy}
              className="mt-4 flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-xs font-medium text-blue-700 transition hover:bg-blue-100 disabled:opacity-50"
            >
              {evidenceBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Load stored session evidence
            </button>
          ) : (
            <p className="mt-3 text-[11px] text-slate-400">
              Session evidence last loaded{" "}
              {selected.lastSessionEvidenceAt
                ? new Intl.DateTimeFormat("en-GB", {
                    month: "short",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  }).format(new Date(selected.lastSessionEvidenceAt))
                : "from stored imports"}
              .
            </p>
          )}

          {evidenceMessage ? (
            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              {evidenceMessage}
            </p>
          ) : null}
        </div>

        {result ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-5 shadow-[0_1px_2px_rgba(15,23,42,0.02)] md:p-6"
          >
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-[18px] w-[18px]" />
              </div>
              <div>
                <p className="font-semibold text-slate-950">
                  {result.status === "exact_duplicate"
                    ? result.crossMachineMatch
                      ? "Cross-machine match detected"
                      : "Exact duplicate skipped"
                    : "Import processed"}
                </p>
                <p className="mt-1 text-xs text-emerald-700/70">
                  Import {result.importId.slice(0, 8)}
                </p>
              </div>
            </div>

            {result.summary ? (
              <>
                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ["New", result.summary.new],
                    ["Revised", result.summary.revised],
                    ["Removed", result.summary.removed],
                    ["Unchanged", result.summary.unchanged],
                  ].map(([label, value]) => (
                    <div
                      key={String(label)}
                      className="rounded-xl border border-emerald-200/80 bg-white/80 p-3"
                    >
                      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        {label}
                      </p>
                      <p className="mt-1 text-xl font-semibold text-slate-950">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <span className="text-slate-500">
                    Before{" "}
                    <b className="text-slate-800">
                      {compact(result.summary.beforeTotal)}
                    </b>
                  </span>
                  <span className="text-slate-500">
                    After{" "}
                    <b className="text-slate-800">
                      {compact(result.summary.afterTotal)}
                    </b>
                  </span>
                  <span className="text-slate-500">
                    Net{" "}
                    <b
                      className={
                        result.summary.netChange >= 0
                          ? "text-emerald-700"
                          : "text-amber-700"
                      }
                    >
                      {result.summary.netChange >= 0 ? "+" : ""}
                      {compact(result.summary.netChange)}
                    </b>
                  </span>
                </div>
              </>
            ) : null}

            {result.modelBackfilled !== undefined ? (
              <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Model enrichment:{" "}
                <b>{result.modelBackfilled.toLocaleString()}</b> model
                observation{result.modelBackfilled === 1 ? "" : "s"} added
                without changing canonical token totals.
              </p>
            ) : null}

            {result.summary?.globalDedupe ? (
              <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-emerald-200 bg-white/80 p-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Mirror rows suppressed
                  </p>
                  <p className="mt-1 text-lg font-semibold text-slate-950">
                    {result.summary.globalDedupe.rowsSuppressed}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                    Duplicate tokens prevented
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-700">
                    {compact(
                      result.summary.globalDedupe.duplicateTokensPrevented,
                    )}
                  </p>
                </div>
              </div>
            ) : null}

            {result.summary?.sessionEvidence?.partialMirrorRisk ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Partial cross-machine session overlap was detected, but the
                daily usage was not identical enough to suppress automatically.
                It remains counted and flagged for review.
              </p>
            ) : null}

            {result.sessionBackfilled !== undefined ? (
              <p className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
                Session evidence:{" "}
                <b>{result.sessionBackfilled.toLocaleString()}</b> new
                fingerprint{result.sessionBackfilled === 1 ? "" : "s"} loaded
                from this exact dataset.
              </p>
            ) : null}

            {result.nextCommand ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white/80 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Next collection
                </p>
                <code className="mt-2 block break-all font-mono text-[11px] leading-5 text-slate-700">
                  {result.nextCommand}
                </code>
              </div>
            ) : null}

            {result.crossMachineMatch ? (
              <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Cross-machine provenance overlaps with{" "}
                <b>{result.duplicateOfMachineId ?? "another machine"}</b>.
                Exact mirrored daily rows are excluded from global totals only
                when the evidence threshold is met; machine-specific totals
                remain unchanged.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
