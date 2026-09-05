import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationPath = new URL(
  "../supabase/migrations/20260905_006_recovered_monthly_usage.sql",
  import.meta.url,
);
const seedPath = new URL(
  "../supabase/seeds/recovered_monthly_usage.sql",
  import.meta.url,
);
const dashboardCardPath = new URL(
  "../components/telemetry/recovered-history-card.tsx",
  import.meta.url,
);

type RecoveredRow = {
  month: string;
  agent: string;
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
};

const rows: RecoveredRow[] = [
  { month: "2026-05", agent: "All", input: 9172233, output: 760817, cacheCreation: 0, cacheRead: 104578084, total: 114511134 },
  { month: "2026-05", agent: "Codex", input: 9162254, output: 760220, cacheCreation: 0, cacheRead: 104572672, total: 114495146 },
  { month: "2026-05", agent: "Gemini CLI", input: 9979, output: 597, cacheCreation: 0, cacheRead: 5412, total: 15988 },
  { month: "2026-06", agent: "All", input: 66366953, output: 6913485, cacheCreation: 0, cacheRead: 1324959636, total: 1398240074 },
  { month: "2026-06", agent: "Codex", input: 53210093, output: 5142031, cacheCreation: 0, cacheRead: 837061376, total: 895413500 },
  { month: "2026-06", agent: "OpenCode", input: 13156860, output: 1771454, cacheCreation: 0, cacheRead: 487898260, total: 502826574 },
  { month: "2026-07", agent: "All", input: 104026745, output: 9579406, cacheCreation: 0, cacheRead: 2360740627, total: 2474346778 },
  { month: "2026-07", agent: "Codex", input: 49931343, output: 3776798, cacheCreation: 0, cacheRead: 1069986560, total: 1123694701 },
  { month: "2026-07", agent: "OpenCode", input: 54093230, output: 5802563, cacheCreation: 0, cacheRead: 1290754067, total: 1350649860 },
  { month: "2026-07", agent: "pi-agent", input: 2172, output: 45, cacheCreation: 0, cacheRead: 0, total: 2217 },
  { month: "2026-08", agent: "All", input: 123631901, output: 14944563, cacheCreation: 0, cacheRead: 5540616452, total: 5679192916 },
  { month: "2026-08", agent: "Codex", input: 96385495, output: 10984851, cacheCreation: 0, cacheRead: 3978407168, total: 4085777514 },
  { month: "2026-08", agent: "OpenCode", input: 27246406, output: 3959712, cacheCreation: 0, cacheRead: 1562209284, total: 1593415402 },
];

const allRows = rows.filter((row) => row.agent === "All");

function sum(rowsToSum: RecoveredRow[], key: keyof RecoveredRow) {
  return rowsToSum.reduce((total, row) => total + Number(row[key]), 0);
}

test("recovered monthly evidence reconciles within each month and overall", () => {
  for (const all of allRows) {
    const agents = rows.filter(
      (row) => row.month === all.month && row.agent !== "All",
    );
    for (const key of [
      "input",
      "output",
      "cacheCreation",
      "cacheRead",
      "total",
    ] as const) {
      assert.equal(sum(agents, key), all[key], `${all.month} ${key}`);
    }
  }

  assert.deepEqual(
    ["input", "output", "cacheCreation", "cacheRead", "total"].map((key) =>
      sum(allRows, key as keyof RecoveredRow),
    ),
    [303197832, 32198271, 0, 9330894799, 9666290902],
  );
  assert.equal(rows.length, 13);
});

test("recovery migration is isolated, protected, and constrained", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create table if not exists public\.recovered_usage_sets/);
  assert.match(migration, /create table if not exists public\.recovered_monthly_usage/);
  assert.match(migration, /references public\.recovered_usage_sets\(id\) on delete restrict/);
  assert.match(migration, /unique\(recovery_set_id, month, agent\)/);
  assert.match(migration, /month = date_trunc\('month', month\)::date/);
  assert.match(migration, /input_tokens >= 0/);
  assert.match(migration, /alter table public\.recovered_usage_sets enable row level security/);
  assert.match(migration, /alter table public\.recovered_monthly_usage enable row level security/);
  assert.match(migration, /revoke all on table public\.recovered_usage_sets from anon, authenticated/);
  assert.match(migration, /grant all on table public\.recovered_monthly_usage to service_role/);

  for (const canonicalName of [
    "daily_usage_observations",
    "daily_model_usage_observations",
    "session_usage_observations",
    "cross_machine_daily_dedupe",
    "imports",
    "process_ccusage_import_v3",
  ]) {
    assert.doesNotMatch(migration, new RegExp(canonicalName));
  }
});

test("seed is deterministic, idempotent, and preserves warnings/model-name evidence", async () => {
  const seed = await readFile(seedPath, "utf8");

  assert.match(seed, /lost-windows-history-2026-05-08/);
  assert.match(seed, /on conflict \(id\) do nothing/);
  assert.match(seed, /on conflict \(recovery_set_id, month, agent\) do nothing/);
  assert.match(seed, /\n  2,\n  true,/);
  assert.match(seed, /evidence_only_non_additive/);
  assert.match(seed, /pricing_complete,\s*warnings/);
  assert.match(seed, /laguna-s-2\.1-free/);
  assert.match(seed, /ox-alpha-free/);
  assert.match(seed, /raw_terminal_text/);
  assert.match(seed, /v_mismatched_rows/);
  assert.match(seed, /gpt-5\.4-mini/);
  assert.match(seed, /\[pi\] deepseek-v4-flash/);
  assert.doesNotMatch(seed, /model_(?:input|output|cache|total)_tokens/);
});

test("models remain names only and recovered totals stay outside canonical views", async () => {
  const [migration, seed, card] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(seedPath, "utf8"),
    readFile(dashboardCardPath, "utf8"),
  ]);

  assert.match(migration, /models text\[\]/);
  assert.match(card, /Recovered History/);
  assert.match(card, /Evidence only/);
  assert.match(card, /Not added to canonical telemetry/);
  assert.match(card, /suspected-mirrored/);
  assert.match(card, /No per-model token totals were fabricated/);
  assert.doesNotMatch(seed, /daily_usage_observations|v_current_daily_usage|cross_machine_daily_dedupe/);
});
