"use client";

import { Loader2, Plus, Server } from "lucide-react";
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
    <div className="grid gap-4 xl:grid-cols-[.7fr_1.3fr]">
      <form
        onSubmit={submit}
        className="rounded-3xl border border-white/10 bg-white/[0.035] p-5"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 p-2.5 text-cyan-300">
            <Plus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-semibold">Register machine</h2>
            <p className="mt-1 text-xs text-slate-500">
              Uploads can only select identities defined here.
            </p>
          </div>
        </div>

        <label className="mt-5 block text-xs text-slate-400">
          Display name
          <input
            value={name}
            onChange={(event) => updateName(event.target.value)}
            placeholder="OpenClaw VM"
            required
            className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#0a1620] px-3 text-sm outline-none ring-cyan-400 focus:ring-1"
          />
        </label>

        <label className="mt-4 block text-xs text-slate-400">
          Stable ID
          <input
            value={id}
            onChange={(event) => setId(event.target.value.toLowerCase())}
            placeholder="openclaw-vm"
            required
            pattern="[a-z0-9][a-z0-9-]{1,63}"
            className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#0a1620] px-3 font-mono text-sm outline-none ring-cyan-400 focus:ring-1"
          />
        </label>

        <button
          disabled={busy || !id || !name}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 text-sm font-semibold text-slate-950 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Add machine
        </button>
        {message ? <p className="mt-3 text-xs text-slate-400">{message}</p> : null}
      </form>

      <div className="rounded-3xl border border-white/10 bg-white/[0.035] p-5">
        <div className="mb-5">
          <h2 className="font-semibold">Registered machines</h2>
          <p className="mt-1 text-xs text-slate-500">
            Stable foreign-key identities for every import.
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {machines.length ? (
            machines.map((machine) => (
              <div
                key={machine.id}
                className="rounded-2xl border border-white/10 bg-black/15 p-4"
              >
                <div className="flex items-center gap-3">
                  <Server className="h-4 w-4 text-emerald-300" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{machine.name}</p>
                    <code className="text-[11px] text-slate-600">{machine.id}</code>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-500">No machines registered yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
