export const OPENCODE_GO_BUCKET =
  process.env.OPENCODE_GO_IMPORT_BUCKET ?? "opencode-go-imports";

export const OPENCODE_GO_STATUSES = [
  "processing",
  "processed",
  "exact_duplicate",
  "failed",
] as const;

export type OpenCodeGoImportStatus = (typeof OPENCODE_GO_STATUSES)[number];
