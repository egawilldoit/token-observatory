export function isCrossOriginRequest(request: Request) {
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
