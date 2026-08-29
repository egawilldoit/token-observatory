import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeUtf8Strict,
  isCrossOriginRequest,
  requestExceedsBytes,
} from "../lib/http/request";

test("same-origin mutation requests are accepted", () => {
  const request = new Request("https://usage.example/api/imports", {
    method: "POST",
    headers: { origin: "https://usage.example" },
  });

  assert.equal(isCrossOriginRequest(request), false);
});

test("cross-origin mutation requests are rejected", () => {
  const request = new Request("https://usage.example/api/imports", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });

  assert.equal(isCrossOriginRequest(request), true);
});

test("requests without an Origin header remain usable by trusted non-browser clients", () => {
  const request = new Request("https://usage.example/api/imports", {
    method: "POST",
  });

  assert.equal(isCrossOriginRequest(request), false);
});

test("content-length guard rejects oversized requests before multipart parsing", () => {
  const request = new Request("https://usage.example/api/imports", {
    method: "POST",
    headers: { "content-length": "9000000" },
  });

  assert.equal(requestExceedsBytes(request, 8_912_896), true);
});

test("strict UTF-8 decoder rejects replacement-decoded invalid bytes", () => {
  assert.throws(
    () => decodeUtf8Strict(Uint8Array.from([0xc3, 0x28])),
    /encoded data was not valid|valid for encoding/i,
  );
});


test("Sec-Fetch-Site cross-site is rejected even without Origin", () => {
  const request = new Request("https://usage.example/api/imports", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });

  assert.equal(isCrossOriginRequest(request), true);
});
