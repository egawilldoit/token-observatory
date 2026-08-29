function normalizedHost(value: string | null) {
  if (!value) return null;
  return value.split(",")[0]?.trim().toLowerCase() || null;
}

export function isCrossOriginRequest(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = normalizedHost(request.headers.get("x-forwarded-host"));
    const host = forwardedHost ?? normalizedHost(request.headers.get("host"));

    if (host) {
      const forwardedProto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
        new URL(request.url).protocol.replace(":", "");
      return originUrl.origin !== forwardedProto + "://" + host;
    }

    return originUrl.origin !== new URL(request.url).origin;
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
