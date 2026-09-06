import "server-only";

import {
  fetchProviderMonthly,
  type OpenCodeGoProviderFetchResult,
} from "./provider-schema";

/**
 * OpenCode Go provider client, server-side entrypoint (V2, MONTHLY ONLY).
 *
 * This module holds the REAL server-only boundary: it reads
 * `OPENCODE_GO_API_KEY` from the server environment and performs the live
 * fetch. All runtime-independent logic (schema validation, error mapping,
 * timeout handling) lives in `provider-schema.ts` so it stays unit-testable.
 * Client components must never import this module (or `-schema`); they call
 * the API routes, which return only sanitized comparisons.
 */

export function getOpenCodeGoApiKey(): string | null {
  const key = process.env.OPENCODE_GO_API_KEY?.trim();
  return key ? key : null;
}

/** Live monthly fetch using the configured server key. */
export async function fetchConfiguredProviderMonthly(args: {
  timeoutMs?: number;
  fetchFn?: typeof fetch;
  url?: string;
}): Promise<OpenCodeGoProviderFetchResult> {
  const apiKey = getOpenCodeGoApiKey();
  if (!apiKey) {
    const { OpenCodeGoProviderError } = await import("./provider-schema");
    throw new OpenCodeGoProviderError("not_configured", "OpenCode Go API key is not configured");
  }
  return fetchProviderMonthly({ apiKey, ...args });
}

export type { OpenCodeGoProviderFetchResult };
