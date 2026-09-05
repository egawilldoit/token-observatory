"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

type ImportResult =
  | {
      status: "processed";
      importId: string;
      checkpointCount: number;
      latestRecordedActual: { value: number; source: string; checkpointDate: string | null };
      formulaMismatchCount: number;
    }
  | {
      status: "exact_duplicate";
      importId: string;
      duplicateOfImportId: string;
    };

const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function friendlyError(status: number, serverMessage: string | null): string {
  if (serverMessage) return serverMessage;
  if (status === 413) return "File is too large. The .xlsx tracker must be 4 MiB or smaller.";
  if (status === 409) return "This upload conflicts with accepted history. See details below.";
  if (status === 401 || status === 403) return "You do not have access to upload trackers.";
  return "Upload failed. Try again.";
}

export function TrackerUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function upload(file: File) {
    setResult(null);
    setError(null);
    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      setError("File is too large. The .xlsx tracker must be 4 MiB or smaller.");
      return;
    }

    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/opencode-go/import", {
        method: "POST",
        body: form,
      });
      const body = (await res.json().catch(() => null)) as
        | (ImportResult & { error?: string })
        | { error?: string }
        | null;
      if (!res.ok) {
        setError(friendlyError(res.status, (body as { error?: string } | null)?.error ?? null));
        return;
      }
      setResult(body as ImportResult);
      router.refresh();
    } catch {
      setError("Upload failed. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section
      aria-label="Upload monthly tracker"
      className="mt-4 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.025)]"
    >
      <h2 className="font-semibold text-slate-950">Upload monthly tracker</h2>
      <p className="mt-1 text-xs text-slate-500">
        Accepts the OpenCode Go monthly tracker .xlsx up to 4 MiB. Recorded Actual Usage
        values become the V1 observation source.
      </p>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !busy) void upload(file);
        }}
        className={`mt-4 flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-8 text-center transition ${
          dragging ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-slate-50/60"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          aria-label="Choose an .xlsx tracker file"
          className="text-xs text-slate-600 file:mr-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:px-3 file:py-2 file:text-xs file:font-medium file:text-slate-700"
        />
        <p className="text-xs text-slate-500">
          {busy ? "Uploading…" : "Choose a file or drop it here"}
        </p>
      </div>
      {result?.status === "processed" ? (
        <div role="status" className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-medium">Tracker imported.</p>
          <p className="mt-1 text-xs">
            {result.checkpointCount} checkpoints · last recorded{" "}
            {(result.latestRecordedActual.value * 100).toFixed(1)}%
            {result.latestRecordedActual.checkpointDate
              ? ` (${result.latestRecordedActual.checkpointDate})`
              : " (baseline)"}
          </p>
          {result.formulaMismatchCount > 0 ? (
            <p className="mt-1 text-xs">
              Workbook formulas differ from Token Observatory calculations in{" "}
              {result.formulaMismatchCount} {result.formulaMismatchCount === 1 ? "cell" : "cells"}.
              Token Observatory calculations are being used.
            </p>
          ) : null}
        </div>
      ) : null}
      {result?.status === "exact_duplicate" ? (
        <div role="status" className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <p className="font-medium">Exact duplicate.</p>
          <p className="mt-1 text-xs">
            This workbook was already imported. No new snapshot was created.
          </p>
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      ) : null}
    </section>
  );
}