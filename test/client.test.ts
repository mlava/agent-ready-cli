import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createConfig,
  getScan,
  listScans,
  postAsk,
  postScan,
  scanMcp,
  type Config,
} from "@/client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const config: Config = {
  baseUrl: "https://agent-ready.dev",
  apiKey: "ar_live_test",
  scanTimeoutMs: 1000,
  getTimeoutMs: 1000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createConfig", () => {
  it("uses defaults when env is empty", () => {
    const c = createConfig({} as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe("https://agent-ready.dev");
    expect(c.apiKey).toBeNull();
    expect(c.scanTimeoutMs).toBeGreaterThan(0);
  });

  it("strips a trailing slash from the base URL", () => {
    const c = createConfig({ AGENT_READY_API_URL: "http://localhost:3000/" } as NodeJS.ProcessEnv);
    expect(c.baseUrl).toBe("http://localhost:3000");
  });

  it("reads the API key and trims it", () => {
    const c = createConfig({ AGENT_READY_API_KEY: "  ar_live_x  " } as NodeJS.ProcessEnv);
    expect(c.apiKey).toBe("ar_live_x");
  });

  it("falls back to defaults for non-numeric timeouts", () => {
    const c = createConfig({ AGENT_READY_GET_TIMEOUT_MS: "nope" } as NodeJS.ProcessEnv);
    expect(c.getTimeoutMs).toBeGreaterThan(0);
  });
});

describe("authenticated calls", () => {
  it("postScan sends a Bearer token and JSON body", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "x", status: "running", url: "https://e.com", pollUrl: "/p" }, 202));
    const res = await postScan(config, { url: "https://e.com", pageLimit: 10 });
    expect(res.id).toBe("x");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://agent-ready.dev/api/v1/scans");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer ar_live_test",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      url: "https://e.com",
      pageLimit: 10,
    });
  });

  it("getScan URL-encodes the id", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ id: "a/b" }));
    await getScan(config, "a/b");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://agent-ready.dev/api/v1/scans/a%2Fb",
    );
  });

  it("listScans builds the query string", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: [] }));
    await listScans(config, { limit: 5, cursor: "2026-01-01T00:00:00.000Z" });
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("limit=5");
    expect(url).toContain("cursor=2026-01-01");
  });

  it("throws a typed ApiError on a structured error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ error: { code: "subscription_required", message: "Pro only" } }, 403),
    );
    await expect(getScan(config, "x")).rejects.toMatchObject({
      code: "subscription_required",
      status: 403,
    });
  });

  it("throws missing_api_key before making a request when no key is set", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(
      getScan({ ...config, apiKey: null }, "x"),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("scanMcp (public)", () => {
  it("posts the endpoint without requiring a key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { scan: { id: "m1", mcpScore: 92 }, shareUrl: "/mcp-server-scanner/m1" },
        201,
      ),
    );
    const res = await scanMcp({ ...config, apiKey: null }, "https://mcp.x/mcp");
    expect(res.scan.mcpScore).toBe(92);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://agent-ready.dev/api/v1/scan/mcp");
    expect((init as RequestInit).method).toBe("POST");
    expect(
      (init!.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      endpoint: "https://mcp.x/mcp",
    });
  });

  it("throws a typed ApiError on a blocked endpoint (400)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        { error: { code: "invalid_request", message: "blocked" } },
        400,
      ),
    );
    await expect(scanMcp(config, "http://localhost/mcp")).rejects.toMatchObject({
      code: "invalid_request",
      status: 400,
    });
  });
});

describe("postAsk (public)", () => {
  it("works without an API key and omits the Authorization header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ _meta: {}, results: [] }));
    await postAsk({ ...config, apiKey: null }, { q: "hi" });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("passes through a 404 NO_RESULTS envelope instead of throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ _meta: { code: "NO_RESULTS", message: "nothing" }, results: [] }, 404),
    );
    const res = (await postAsk(config, { q: "zzz" })) as { _meta: { code: string } };
    expect(res._meta.code).toBe("NO_RESULTS");
  });

  it("wraps the query in the NLWeb request shape", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ _meta: {}, results: [] }));
    await postAsk(config, { q: "hi", mode: "summarize", itemType: "checks" });
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body).toEqual({
      query: { q: "hi", itemType: "checks" },
      prefer: { mode: "summarize" },
    });
  });
});
