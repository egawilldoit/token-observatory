export const OPENCODE_GO_BUCKET =
  process.env.OPENCODE_GO_IMPORT_BUCKET ?? "opencode-go-imports";

export const OPENCODE_GO_STATUSES = [
  "processing",
  "processed",
  "exact_duplicate",
  "failed",
] as const;

export type OpenCodeGoImportStatus = (typeof OPENCODE_GO_STATUSES)[number];

/** Supported V1 workbook contract (sheet/title). Production parsing and the
 * deterministic fixture generator share these so they cannot drift apart. */
export const OPENCODE_GO_WORKBOOK_SHEET = "Monthly Tracker";
export const OPENCODE_GO_WORKBOOK_TITLE = "OpenCode Go — Monthly Usage Tracker";
export const OPENCODE_GO_DEFAULT_CHECK_TIME = "12:00";
