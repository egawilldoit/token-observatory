import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const queryPath = new URL("../lib/recovery/queries.ts", import.meta.url);
const dashboardPath = new URL(
  "../components/telemetry/dashboard-view.tsx",
  import.meta.url,
);
const correctionMigrationPath = new URL(
  "../supabase/migrations/20260905_007_recovered_additive_accounting.sql",
  import.meta.url,
);

test("latest recovery evidence keeps monthly rows aligned with the selected set", async () => {
  const query = await readFile(queryPath, "utf8");

  assert.match(query, /const RECOVERED_SET_ID = "lost-windows-history-2026-05-08"/);
  assert.match(query, /\.eq\("id", RECOVERED_SET_ID\)/);
  assert.match(query, /\.limit\(1\)/);
  assert.match(query, /getRecoveredMonthlyRows\(set\.id\)/);
  assert.doesNotMatch(
    query,
    /Promise\.all\([\s\S]*getRecoveredMonthlyRows\(\)[\s\S]*\)/,
  );
});

test("the main dashboard owns recovered-history inclusion copy", async () => {
  const dashboard = await readFile(dashboardPath, "utf8");

  assert.match(dashboard, /Lost Windows PC history is included/);
  assert.match(dashboard, /Daily and weekly detail is unavailable/);
  assert.match(dashboard, /per-model token attribution is unavailable/);
  assert.doesNotMatch(dashboard, /KnownUsageSummary|RecoveredHistoryCard/);
});

test("additive correction migration is safe before the recovery seed exists", async () => {
  const migration = await readFile(correctionMigrationPath, "utf8");

  assert.match(migration, /seeds run after the migration chain/);
  assert.doesNotMatch(migration, /v_updated\s*<>\s*1/);
  assert.match(migration, /where id = 'lost-windows-history-2026-05-08'/);
  assert.match(migration, /if exists \(/);
});
