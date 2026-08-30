"use client";

import { CheckCircle2, Loader2, Plus, Server } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { MachineRow } from "@/lib/telemetry/queries";

export function MachineManager({ machines }: { machines: MachineRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function updateName(value: string) {
    setName(value);
    setId(
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64),
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/machines", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not create machine.");

      setName("");
      setId("");
      setMessage("Machine registered.");
      router.refresh();
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Could not create machine.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.72fr)_minmax(0,1.28fr)]">
      <form onSubmit={submit} className="obs-card p-5 md:p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <Plus className="h-[18px] w-[18px]" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-950">Register machine</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Uploads can only select stable identities defined here.
            </p>
          </div>
        </div>

        <label className="mt-6 block text-xs font-medium text-slate-600">
          Display name
          <input
            value={name}
            onChange={(event) => updateName(event.target.value)}
            placeholder="OpenClaw VM"
            required
            className="obs-control mt-2 w-full"
          />
        </label>

        <label className="mt-5 block text-xs font-medium text-slate-600">
          Stable ID
          <input
            value={id}
            onChange={(event) => setId(event.target.value.toLowerCase())}
            placeholder="openclaw-vm"
            required
            pattern="[a-z0-9][a-z0-9-]{1,63}"
            className="obs-control mt-2 w-full font-mono"
          />
        </label>

        <button
          disabled={busy || !id || !name}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add machine
        </button>

        {message ? (
          <div
            role="status"
            className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {message}
          </div>
        ) : null}
      </form>

      <section className="obs-card p-5 md:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-950">Registered machines</h2>
            <p className="mt-1 text-xs text-slate-500">
              Stable foreign-key identities for every import.
            </p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            {machines.length} total
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {machines.length ? (
            machines.map((machine) => (
              <div
                key={machine.id}
                className="rounded-2xl border border-slate-200 bg-slate-50/55 p-4 transition hover:border-blue-200 hover:bg-blue-50/30"
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Server className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {machine.name}
                    </p>
                    <code className="mt-0.5 block truncate text-[11px] text-slate-400">
                      {machine.id}
                    </code>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-10 text-center text-sm text-slate-500">
              No machines registered yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
