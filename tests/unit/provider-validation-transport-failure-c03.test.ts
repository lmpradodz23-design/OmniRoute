// Final audit C-03: an OpenAI-compatible provider whose base URL cannot be reached
// (timeout / connection refused / DNS / TLS) used to have its transport error swallowed
// by validateOpenAICompatibleProvider's `catch {}` and replaced by the generic
// "Endpoint /models unavailable…" text, which the public path redactor then collapsed
// to "Endpoint <path>". The user saw an unreadable message with the wrong cause.
//
// Now: toValidationErrorResult() classifies transport failures into typed codes
// (UPSTREAM_TIMEOUT / UPSTREAM_UNREACHABLE / UPSTREAM_TLS) with the dialed host and a
// readable sentence (no URL path, no filesystem path), and the validator returns that
// result immediately instead of probing the chat endpoint on the same dead host.
import test from "node:test";
import assert from "node:assert/strict";

// Must be set before safeOutboundFetch is loaded: the probe timeout is read once at import.
process.env.OMNIROUTE_PROVIDER_PROBE_TIMEOUT_MS = "1000";

const { SafeOutboundFetchError } = await import("../../src/shared/network/safeOutboundFetch.ts");
const { toValidationErrorResult, describeValidationTransportFailure } =
  await import("../../src/lib/providers/validation/transport.ts");
const { validateOpenAICompatibleProvider } =
  await import("../../src/lib/providers/validation/openaiFormat.ts");
const { sanitizeErrorMessage } = await import("../../open-sse/utils/errorSanitization.ts");

function outboundError(
  code: "TIMEOUT" | "NETWORK_ERROR",
  url: string,
  extra: { timeoutMs?: number; cause?: unknown; message?: string } = {}
) {
  return new SafeOutboundFetchError(extra.message ?? `Outbound request failed for ${url}`, {
    code,
    url,
    method: "GET",
    attempts: 2,
    isRetryable: true,
    timeoutMs: extra.timeoutMs,
    cause: extra.cause,
  });
}

function fetchFailed(causeCode: string, causeMessage = causeCode) {
  const cause = Object.assign(new Error(causeMessage), { code: causeCode });
  return Object.assign(new TypeError("fetch failed"), { cause });
}

test("C-03: a probe timeout becomes UPSTREAM_TIMEOUT with host + seconds and no URL path", () => {
  const result = toValidationErrorResult(
    outboundError("TIMEOUT", "http://10.255.255.1/v1/models", {
      timeoutMs: 15000,
      message: "Request to http://10.255.255.1/v1/models timed out after 15000ms",
    })
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "UPSTREAM_TIMEOUT");
  assert.equal(result.host, "10.255.255.1");
  assert.equal(result.timeoutMs, 15000);
  assert.equal(result.timeout, true);
  assert.equal(
    result.error,
    "Could not connect to 10.255.255.1: timed out after 15 s. Check the URL and that the service is running."
  );
  assert.doesNotMatch(result.error, /\/v1\/models|<path>/);
  // The sentence survives the public sanitizer verbatim.
  assert.equal(sanitizeErrorMessage(result.error), result.error);
});

test("C-03: ECONNREFUSED / ENOTFOUND become UPSTREAM_UNREACHABLE with a readable reason", () => {
  const refused = toValidationErrorResult(
    outboundError("NETWORK_ERROR", "http://localhost:11434/v1/models", {
      cause: fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:11434"),
    })
  );
  assert.equal(refused.code, "UPSTREAM_UNREACHABLE");
  assert.equal(refused.host, "localhost:11434");
  assert.equal(
    refused.error,
    "Could not connect to localhost:11434 (connection refused). Check the URL and that the service is running."
  );

  const notFound = toValidationErrorResult(
    outboundError("NETWORK_ERROR", "https://llm.example.invalid/v1/models", {
      cause: fetchFailed("ENOTFOUND", "getaddrinfo ENOTFOUND llm.example.invalid"),
    })
  );
  assert.equal(notFound.code, "UPSTREAM_UNREACHABLE");
  assert.match(notFound.error, /^Could not connect to llm\.example\.invalid \(host not found\)\./);

  // An AggregateError cause (dual-stack localhost) is unwrapped too.
  const aggregate = new AggregateError(
    [Object.assign(new Error("connect ECONNREFUSED ::1:11434"), { code: "ECONNREFUSED" })],
    ""
  );
  const dualStack = toValidationErrorResult(
    outboundError("NETWORK_ERROR", "http://localhost:11434/v1/models", {
      cause: Object.assign(new TypeError("fetch failed"), { cause: aggregate }),
    })
  );
  assert.equal(dualStack.code, "UPSTREAM_UNREACHABLE");
  assert.match(dualStack.error, /connection refused/);
});

test("C-03: certificate failures become UPSTREAM_TLS", () => {
  const result = toValidationErrorResult(
    outboundError("NETWORK_ERROR", "https://llm.example.com:8443/v1/models", {
      cause: fetchFailed("DEPTH_ZERO_SELF_SIGNED_CERT", "self-signed certificate"),
    })
  );
  assert.equal(result.code, "UPSTREAM_TLS");
  assert.equal(result.host, "llm.example.com:8443");
  assert.equal(
    result.error,
    "TLS handshake with llm.example.com:8443 failed (DEPTH_ZERO_SELF_SIGNED_CERT). Check the certificate and the https:// URL."
  );
});

test("C-03: non-transport errors keep the legacy sanitized shape (no typed code)", () => {
  const plain = toValidationErrorResult(new Error("Provider probe exploded"));
  assert.equal(plain.error, "Provider probe exploded");
  assert.equal("code" in plain, false);
  assert.equal(describeValidationTransportFailure(new Error("boom")), null);
  assert.equal(describeValidationTransportFailure("not an error"), null);
});

async function withMockedFetch<T>(
  impl: (url: string, init: RequestInit | undefined) => Promise<Response>,
  run: (calls: string[]) => Promise<T>
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(href);
    return impl(href, init);
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("C-03: validateOpenAICompatibleProvider reports a refused connection as typed, without the `Endpoint /models` text", async () => {
  const result = await withMockedFetch(
    async () => {
      throw fetchFailed("ECONNREFUSED", "connect ECONNREFUSED 203.0.113.9:8080");
    },
    async (calls) => {
      const r = await validateOpenAICompatibleProvider({
        apiKey: "sk-test",
        providerSpecificData: { baseUrl: "http://llm.example.com:8080/v1" },
      });
      assert.ok(calls.length >= 1);
      assert.ok(
        calls.every((href) => href.endsWith("/v1/models")),
        `chat probe must not run on a dead host, got: ${calls.join(", ")}`
      );
      return r;
    }
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "UPSTREAM_UNREACHABLE");
  assert.equal(result.host, "llm.example.com:8080");
  assert.match(
    result.error,
    /^Could not connect to llm\.example\.com:8080 \(connection refused\)\./
  );
  assert.doesNotMatch(result.error, /Endpoint|<path>|\/models/);
});

test("C-03: validateOpenAICompatibleProvider reports a probe timeout as UPSTREAM_TIMEOUT even when a model id was given", async () => {
  const result = await withMockedFetch(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("This operation was aborted", "AbortError"))
        );
      }),
    async (calls) => {
      const r = await validateOpenAICompatibleProvider({
        apiKey: "sk-test",
        providerSpecificData: {
          baseUrl: "http://llm.example.com/v1",
          validationModelId: "some-model",
        },
      });
      assert.ok(
        calls.every((href) => href.endsWith("/v1/models")),
        `chat probe must not run after a host timeout, got: ${calls.join(", ")}`
      );
      return r;
    }
  );
  assert.equal(result.valid, false);
  assert.equal(result.code, "UPSTREAM_TIMEOUT");
  assert.equal(result.host, "llm.example.com");
  assert.equal(result.timeoutMs, 1000);
  assert.equal(
    result.error,
    "Could not connect to llm.example.com: timed out after 1 s. Check the URL and that the service is running."
  );
});

test("C-03: a /models 404 with no model id yields a sentence that survives the path redactor", async () => {
  const result = await withMockedFetch(
    async () => new Response("not found", { status: 404 }),
    async () =>
      validateOpenAICompatibleProvider({
        apiKey: "sk-test",
        providerSpecificData: { baseUrl: "https://llm.example.com/v1" },
      })
  );
  assert.equal(result.valid, false);
  assert.equal("code" in result, false);
  assert.equal(
    result.error,
    "The models endpoint answered HTTP 404. Provide a Model ID to validate via chat completions."
  );
  assert.equal(sanitizeErrorMessage(result.error), result.error);
});
