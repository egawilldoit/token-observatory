export function isCrossOriginRequest(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return true;
  }
}

export function requestExceedsBytes(request: Request, maxBytes: number) {
  const header = request.headers.get("content-length");
  if (!header) return false;

  const value = Number(header);
  return Number.isFinite(value) && value > maxBytes;
}

export function decodeUtf8Strict(bytes: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
