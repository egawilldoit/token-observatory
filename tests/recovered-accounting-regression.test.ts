import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const queryPath = new URL("../lib/recovery/queries.ts", import.meta.url);
const cardPath = new URL(
  "../components/telemetry/recovered-history-card.tsx",
  import.meta.url,
);
const correctionMigrationPath = new URL(
  "../supabase/migrations/20260905_007_recovered_additive_accounting.sql",
  import.meta.url,
);

test("latest recovery evidence keeps monthly rows aligned with the selected set", async () => {
  const query = await readFile(queryPath, "utf8");

  assert.match(query, /\.limit\(1\)/);
  assert.match(query, /getRecoveredMonthlyRows\(set\.id\)/);
  assert.doesNotMatch(
    query,
    /Promise\.all\([\s\S]*getRecoveredMonthlyRows\(\)[\s\S]*\)/,
  );
});

test("recovered-history inclusion copy follows accounting mode", async () => {
  const card = await readFile(cardPath, "utf8");

  assert.match(card, /set\.accounting_mode === "additive_recovered"/);
  assert.match(card, /Included in Total Known Usage/);
  assert.match(card, /Evidence only/);
  assert.match(card, /does not contribute to Total Known Usage/);
  assert.match(card, /excluded from Total Known Usage/);
});

test("additive correction migration is safe before the recovery seed exists", async () => {
  const migration = await readFile(correctionMigrationPath, "utf8");

  assert.match(migration, /seeds run after the migration chain/);
  assert.doesNotMatch(migration, /v_updated\s*<>\s*1/);
  assert.match(migration, /where id = 'lost-windows-history-2026-05-08'/);
  assert.match(migration, /if exists \(/);
});
