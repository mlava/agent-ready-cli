import { describe, expect, it, vi } from "vitest";
import { run, VERSION, type Api, type IO } from "@/cli";
import type {
  McpScanResponse,
  Scan,
  ScanStatus,
  ValidateResult,
} from "@/client";
import { ApiError } from "@/client";

function makeIO(
  color = false,
  stdin = "",
): { io: IO; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: IO = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    color,
    sleep: () => Promise.resolve(),
    readStdin: () => Promise.resolve(stdin),
  };
  return { io, out, err };
}

function scan(status: ScanStatus, overrides: Partial<Scan> = {}): Scan {
  return {
    id: "abc123",
    rootUrl: "https://example.com",
    status,
    createdAt: "2026-05-31T00:00:00.000Z",
    completedAt: status === "running" ? null : "2026-05-31T00:01:00.000Z",
    pagesDiscovered: 3,
    pagesScanned: 3,
    vercelScore: 72,
    vercelRating: "good",
    llmstxtScore: 60,
    accessibilityScore: 88,
    siteChecks: [
      { checkId: "S1", name: "llms.txt exists", status: "pass", message: "", howToFix: null, details: {} },
      { checkId: "S2", name: "agents.md exists", status: "fail", message: "missing", howToFix: "add one", details: {} },
    ],
    llmstxtChecks: [],
    pageResults: [],
    shareToken: "abc123",
    ...overrides,
  };
}

function mcpScan(status: "completed" | "failed" = "completed"): McpScanResponse {
  return {
    scan: {
      id: "m1",
      shareToken: "m1",
      endpoint: "https://mcp.example.com/mcp",
      host: "mcp.example.com",
      status,
      mcpScore: status === "failed" ? 0 : 92,
      mcpRating: status === "failed" ? "needs_improvement" : "excellent",
      serverName: "Example",
      serverVersion: "1.0.0",
      toolCount: 3,
      resourceCount: 0,
      promptCount: 0,
      checks: [
        { checkId: "M1", name: "Handshake", status: "pass", message: "ok", howToFix: null, details: {} },
      ],
    },
    shareUrl: "/mcp-server-scanner/m1",
  };
}

function validateResult(
  overrides: Partial<ValidateResult> = {},
): ValidateResult {
  return {
    mode: "url",
    url: "https://example.com/product",
    checks: [
      { checkId: "D1", name: "Valid JSON-LD", status: "pass", message: "ok", howToFix: null, details: {} },
      { checkId: "D3", name: "Required fields", status: "fail", message: "missing name", howToFix: "add name", details: {} },
    ],
    summary: { pass: 1, warn: 0, fail: 1, verdict: "needs-work" },
    ...overrides,
  };
}

function fakeApi(overrides: Partial<Api> = {}): Api {
  return {
    postScan: vi.fn(async () => ({
      id: "abc123",
      status: "running" as ScanStatus,
      url: "https://example.com",
      pollUrl: "/api/v1/scans/abc123",
    })),
    postAnonScan: vi.fn(async () => ({
      scan: scan("completed"),
      shareUrl: "/scan/abc123",
    })),
    getScan: vi.fn(async () => scan("completed")),
    listScans: vi.fn(async () => ({ data: [] })),
    postAsk: vi.fn(async () => ({ _meta: {}, results: [] })),
    scanMcp: vi.fn(async () => mcpScan()),
    validateStructuredData: vi.fn(async () => validateResult()),
    ...overrides,
  };
}

const ENV = { AGENT_READY_API_KEY: "ar_live_test" } as NodeJS.ProcessEnv;

describe("argument handling", () => {
  it("prints version", async () => {
    const { io, out } = makeIO();
    const code = await run(["--version"], ENV, io, fakeApi());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain(VERSION);
  });

  it("prints help with --help (exit 0)", async () => {
    const { io, out } = makeIO();
    const code = await run(["--help"], ENV, io, fakeApi());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("USAGE");
  });

  it("prints help and exits 1 when no command given", async () => {
    const { io } = makeIO();
    const code = await run([], ENV, io, fakeApi());
    expect(code).toBe(1);
  });

  it("rejects unknown command with exit 2", async () => {
    const { io, err } = makeIO();
    const code = await run(["frobnicate"], ENV, io, fakeApi());
    expect(code).toBe(2);
    expect(err.join("\n")).toContain("Unknown command");
  });

  it("rejects unknown flag with exit 2", async () => {
    const { io } = makeIO();
    const code = await run(["scan", "--bogus"], ENV, io, fakeApi());
    expect(code).toBe(2);
  });
});

describe("scan", () => {
  it("requires a url", async () => {
    const { io } = makeIO();
    const code = await run(["scan"], ENV, io, fakeApi());
    expect(code).toBe(2);
  });

  it("starts a scan and polls until completed", async () => {
    const getScan = vi
      .fn()
      .mockResolvedValueOnce(scan("running"))
      .mockResolvedValueOnce(scan("completed"));
    const api = fakeApi({ getScan });
    const { io, out } = makeIO();
    const code = await run(["scan", "https://example.com"], ENV, io, api);
    expect(code).toBe(0);
    expect(getScan).toHaveBeenCalledTimes(2);
    expect(out.join("\n")).toContain("example.com");
    expect(out.join("\n")).toContain("72/100");
  });

  it("--no-wait prints the queued id without polling", async () => {
    const api = fakeApi();
    const { io, out } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--no-wait"],
      ENV,
      io,
      api,
    );
    expect(code).toBe(0);
    expect(api.getScan).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("abc123");
  });

  it("--json emits parseable JSON", async () => {
    const api = fakeApi({ getScan: vi.fn(async () => scan("completed")) });
    const { io, out } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--json"],
      ENV,
      io,
      api,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("\n"));
    expect(parsed.id).toBe("abc123");
    expect(parsed.vercelScore).toBe(72);
  });

  it("returns 1 when the scan fails", async () => {
    const api = fakeApi({ getScan: vi.fn(async () => scan("failed")) });
    const { io, err } = makeIO();
    const code = await run(["scan", "https://example.com"], ENV, io, api);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("failed");
  });

  it("times out when the scan never completes", async () => {
    // Deadline is computed from Date.now(); advance the clock so the loop
    // exits on the second iteration regardless of poll interval.
    vi.useFakeTimers();
    try {
      const api = fakeApi({ getScan: vi.fn(async () => scan("running")) });
      const sleepy: IO = {
        out: () => {},
        err: () => {},
        color: false,
        sleep: async () => {
          vi.advanceTimersByTime(200_000);
        },
      };
      const code = await run(
        ["scan", "https://example.com", "--timeout", "1"],
        ENV,
        sleepy,
        api,
      );
      expect(code).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a non-integer --page-limit", async () => {
    const { io, err } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--page-limit", "lots"],
      ENV,
      io,
      fakeApi(),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("page-limit");
  });
});

describe("scan (anonymous, no API key)", () => {
  const NO_KEY_ENV = {} as NodeJS.ProcessEnv;

  it("falls back to the anonymous scan path and prints the upsell footer", async () => {
    const api = fakeApi();
    const { io, out } = makeIO();
    const code = await run(["scan", "https://example.com"], NO_KEY_ENV, io, api);
    expect(code).toBe(0);
    expect(api.postAnonScan).toHaveBeenCalledWith(
      expect.anything(),
      "https://example.com",
    );
    expect(api.postScan).not.toHaveBeenCalled();
    expect(api.getScan).not.toHaveBeenCalled();
    const joined = out.join("\n");
    expect(joined).toContain("72/100");
    expect(joined).toContain("Anonymous tier: 3 scans per 30 days");
    expect(joined).toContain("https://agent-ready.dev/pricing");
  });

  it("--json prints the raw scan without the footer", async () => {
    const api = fakeApi();
    const { io, out } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--json"],
      NO_KEY_ENV,
      io,
      api,
    );
    expect(code).toBe(0);
    const joined = out.join("\n");
    expect(JSON.parse(joined).id).toBe("abc123");
    expect(joined).not.toContain("Anonymous tier");
  });

  it("rejects --no-wait without a key", async () => {
    const api = fakeApi();
    const { io, err } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--no-wait"],
      NO_KEY_ENV,
      io,
      api,
    );
    expect(code).toBe(2);
    expect(api.postAnonScan).not.toHaveBeenCalled();
    expect(err.join("\n")).toContain("--no-wait needs an API key");
  });

  it("notes that --page-limit is ignored on the anonymous tier", async () => {
    const api = fakeApi();
    const { io, err } = makeIO();
    const code = await run(
      ["scan", "https://example.com", "--page-limit", "100"],
      NO_KEY_ENV,
      io,
      api,
    );
    expect(code).toBe(0);
    expect(err.join("\n")).toContain("--page-limit is ignored");
  });

  it("surfaces quota exhaustion with the Pro pointer", async () => {
    const api = fakeApi({
      postAnonScan: vi.fn(async () => {
        throw new ApiError(
          "quota_exhausted",
          "Free scan limit reached. Quota resets 2026-08-01.",
          429,
        );
      }),
    });
    const { io, err } = makeIO();
    const code = await run(["scan", "https://example.com"], NO_KEY_ENV, io, api);
    expect(code).toBe(1);
    const joined = err.join("\n");
    expect(joined).toContain("quota_exhausted");
    expect(joined).toContain("https://agent-ready.dev/dashboard/api-keys");
  });
});

describe("get", () => {
  it("requires an id", async () => {
    const { io } = makeIO();
    expect(await run(["get"], ENV, io, fakeApi())).toBe(2);
  });

  it("notes when a scan is still running", async () => {
    const api = fakeApi({ getScan: vi.fn(async () => scan("running")) });
    const { io, out } = makeIO();
    const code = await run(["get", "abc123"], ENV, io, api);
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("still running");
  });
});

describe("list", () => {
  it("renders an empty list", async () => {
    const { io, out } = makeIO();
    const code = await run(["list"], ENV, io, fakeApi());
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("No scans yet");
  });

  it("shows a pagination hint when nextCursor is present", async () => {
    const api = fakeApi({
      listScans: vi.fn(async () => ({
        data: [
          {
            id: "x1",
            shareToken: "x1",
            domain: "example.com",
            rootUrl: "https://example.com",
            vercelScore: 80,
            vercelRating: "good" as const,
            llmstxtScore: 70,
            accessibilityScore: 88,
            pagesScanned: 2,
            createdAt: "2026-05-31T00:00:00.000Z",
          },
        ],
        nextCursor: "2026-05-30T00:00:00.000Z",
      })),
    });
    const { io, out } = makeIO();
    await run(["list"], ENV, io, api);
    expect(out.join("\n")).toContain("--cursor");
  });
});

describe("ask", () => {
  it("requires a query", async () => {
    const { io } = makeIO();
    expect(await run(["ask"], ENV, io, fakeApi())).toBe(2);
  });

  it("works without an API key", async () => {
    const api = fakeApi({
      postAsk: vi.fn(async () => ({
        _meta: {},
        results: [
          { name: "Scoring", url: "https://agent-ready.dev/methodology", description: "how scores work" },
        ],
      })),
    });
    const { io, out } = makeIO();
    const code = await run(["ask", "how", "is", "the", "score", "calculated"], {} as NodeJS.ProcessEnv, io, api);
    expect(code).toBe(0);
    expect(api.postAsk).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ q: "how is the score calculated" }),
    );
    expect(out.join("\n")).toContain("Scoring");
  });
});

describe("mcp-scan", () => {
  it("requires an endpoint", async () => {
    const { io } = makeIO();
    expect(await run(["mcp-scan"], ENV, io, fakeApi())).toBe(2);
  });

  it("scans an MCP server and prints the score (no key needed)", async () => {
    const api = fakeApi({ scanMcp: vi.fn(async () => mcpScan()) });
    const { io, out } = makeIO();
    const code = await run(
      ["mcp-scan", "https://mcp.example.com/mcp"],
      {} as NodeJS.ProcessEnv,
      io,
      api,
    );
    expect(code).toBe(0);
    expect(api.scanMcp).toHaveBeenCalledWith(
      expect.anything(),
      "https://mcp.example.com/mcp",
    );
    expect(out.join("\n")).toContain("92/100");
  });

  it("--json emits parseable JSON", async () => {
    const api = fakeApi({ scanMcp: vi.fn(async () => mcpScan()) });
    const { io, out } = makeIO();
    const code = await run(
      ["mcp-scan", "https://x/mcp", "--json"],
      ENV,
      io,
      api,
    );
    expect(code).toBe(0);
    expect(JSON.parse(out.join("\n")).scan.mcpScore).toBe(92);
  });

  it("returns 1 when the server can't be scanned", async () => {
    const api = fakeApi({ scanMcp: vi.fn(async () => mcpScan("failed")) });
    const { io } = makeIO();
    expect(await run(["mcp-scan", "https://x/mcp"], ENV, io, api)).toBe(1);
  });
});

describe("validate-schema", () => {
  it("requires a target", async () => {
    const { io } = makeIO();
    expect(await run(["validate-schema"], ENV, io, fakeApi())).toBe(2);
  });

  it("validates a URL and prints the verdict (no key needed)", async () => {
    const api = fakeApi();
    const { io, out } = makeIO();
    const code = await run(
      ["validate-schema", "https://example.com/product"],
      {} as NodeJS.ProcessEnv,
      io,
      api,
    );
    expect(code).toBe(1); // fixture has a failing check
    expect(api.validateStructuredData).toHaveBeenCalledWith(expect.anything(), {
      url: "https://example.com/product",
    });
    expect(out.join("\n")).toContain("needs work");
  });

  it("reads JSON-LD from stdin in paste mode (-)", async () => {
    const api = fakeApi({
      validateStructuredData: vi.fn(async () =>
        validateResult({
          mode: "paste",
          url: null,
          summary: { pass: 2, warn: 0, fail: 0, verdict: "agent-ready" },
          checks: [
            { checkId: "D1", name: "Valid JSON-LD", status: "pass", message: "ok", howToFix: null, details: {} },
          ],
        }),
      ),
    });
    const { io, out } = makeIO(false, '{"@type":"Product","name":"X"}');
    const code = await run(["validate-schema", "-"], ENV, io, api);
    expect(code).toBe(0);
    expect(api.validateStructuredData).toHaveBeenCalledWith(expect.anything(), {
      jsonld: '{"@type":"Product","name":"X"}',
    });
    expect(out.join("\n")).toContain("agent ready");
  });

  it("errors when stdin paste is empty", async () => {
    const { io } = makeIO(false, "   ");
    expect(await run(["validate-schema", "-"], ENV, io, fakeApi())).toBe(2);
  });

  it("--json emits parseable JSON", async () => {
    const api = fakeApi();
    const { io, out } = makeIO();
    const code = await run(
      ["validate-schema", "https://x/p", "--json"],
      ENV,
      io,
      api,
    );
    expect(JSON.parse(out.join("\n")).summary.verdict).toBe("needs-work");
    expect(code).toBe(1);
  });
});

describe("error handling", () => {
  it("surfaces ApiError code and message, exit 1", async () => {
    // `get` still requires a key — keyless `scan` now falls back to the
    // anonymous path instead of erroring, so the generic ApiError surface
    // is exercised through the history command.
    const api = fakeApi({
      getScan: vi.fn(async () => {
        throw new ApiError("missing_api_key", "No API key set.");
      }),
    });
    const { io, err } = makeIO();
    const code = await run(["get", "abc123"], {} as NodeJS.ProcessEnv, io, api);
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("missing_api_key");
  });
});
