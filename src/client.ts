// Minimal REST client for the agent-ready.dev API. The CLI is a thin
// argv→HTTPS wrapper: command handlers call into this client, which sends
// Bearer-authenticated requests to the hosted REST endpoints. Mirrors the
// transport in the agent-ready-mcp package so behaviour stays consistent.

export interface Config {
  baseUrl: string;
  apiKey: string | null;
  scanTimeoutMs: number;
  getTimeoutMs: number;
}

const DEFAULT_BASE_URL = "https://agent-ready.dev";
const DEFAULT_SCAN_TIMEOUT_MS = 120_000;
const DEFAULT_GET_TIMEOUT_MS = 10_000;

export function createConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const rawBase = env.AGENT_READY_API_URL ?? DEFAULT_BASE_URL;
  // Strip any trailing slash so we can append /api/v1/... cleanly.
  const baseUrl = rawBase.replace(/\/+$/, "");
  const apiKey = (env.AGENT_READY_API_KEY?.trim() ?? "") || null;

  const scanTimeoutMs = positiveIntOr(
    env.AGENT_READY_SCAN_TIMEOUT_MS,
    DEFAULT_SCAN_TIMEOUT_MS,
  );
  const getTimeoutMs = positiveIntOr(
    env.AGENT_READY_GET_TIMEOUT_MS,
    DEFAULT_GET_TIMEOUT_MS,
  );

  return { baseUrl, apiKey, scanTimeoutMs, getTimeoutMs };
}

function positiveIntOr(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface FetchOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  timeoutMs: number;
}

async function call<T>(config: Config, opts: FetchOptions): Promise<T> {
  if (!config.apiKey) {
    throw new ApiError(
      "missing_api_key",
      "No API key set. Issue a Pro API key from https://agent-ready.dev/dashboard/api-keys, then pass --api-key or set AGENT_READY_API_KEY.",
    );
  }

  const url = `${config.baseUrl}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ApiError(
        "timeout",
        `Request to ${opts.path} timed out after ${opts.timeoutMs}ms.`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      "network_error",
      `Network error calling ${opts.path}: ${message}`,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON body — fall through with raw text in the error message
      // (rare; agent-ready always responds with JSON, but networks lie).
    }
  }

  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    const code = detail?.code ?? `http_${res.status}`;
    const message =
      (detail?.message ?? text) || `HTTP ${res.status} from ${opts.path}`;
    throw new ApiError(code, message, res.status);
  }

  return payload as T;
}

// ---- API response types (subset; mirrors src/lib/api/schemas.ts in the
// main repo). We type only the fields the CLI reads or prints. ----

export type CheckStatus = "pass" | "fail" | "warn" | "error";
export type ScanStatus = "running" | "completed" | "failed";
export type VercelRating =
  | "excellent"
  | "good"
  | "fair"
  | "needs_improvement";

export interface CheckResult {
  checkId: string;
  name: string;
  status: CheckStatus;
  message: string;
  howToFix: string | null;
  details: Record<string, unknown>;
}

export interface Scan {
  id: string;
  rootUrl: string;
  status: ScanStatus;
  createdAt: string;
  completedAt: string | null;
  pagesDiscovered: number;
  pagesScanned: number;
  vercelScore: number;
  vercelRating: VercelRating;
  llmstxtScore: number;
  siteChecks: CheckResult[];
  llmstxtChecks: CheckResult[];
  pageResults: { url: string; checks: CheckResult[] }[];
  shareToken: string;
  // Corpus benchmark (nullable; absent on a thin corpus or an older API).
  // `percentile` = share of scanned sites this score beats; `corpusTotal` =
  // the number of sites it's measured against.
  percentile?: number | null;
  corpusTotal?: number | null;
}

export interface StartScanResponse {
  id: string;
  status: ScanStatus;
  url: string;
  pollUrl: string;
}

export interface ScanSummary {
  id: string;
  shareToken: string;
  domain: string;
  rootUrl: string;
  vercelScore: number | null;
  vercelRating: VercelRating | null;
  llmstxtScore: number | null;
  pagesScanned: number | null;
  createdAt: string;
  percentile?: number | null;
  corpusTotal?: number | null;
}

export interface ScanListResponse {
  data: ScanSummary[];
  nextCursor?: string;
}

export interface McpScan {
  id: string;
  shareToken: string;
  endpoint: string;
  host: string;
  status: "completed" | "failed";
  mcpScore: number;
  mcpRating: VercelRating;
  serverName: string | null;
  serverVersion: string | null;
  toolCount: number | null;
  resourceCount: number | null;
  promptCount: number | null;
  checks: CheckResult[];
}

export interface McpScanResponse {
  scan: McpScan;
  shareUrl: string;
}

export type ValidateMode = "url" | "paste";
export type ValidateVerdict =
  | "agent-ready"
  | "needs-work"
  | "not-agent-readable";

export interface ValidateSummary {
  pass: number;
  warn: number;
  fail: number;
  verdict: ValidateVerdict;
}

export interface ValidateResult {
  mode: ValidateMode;
  url: string | null;
  checks: CheckResult[];
  summary: ValidateSummary;
}

export interface ValidateInput {
  /** Provide exactly one of `url` (fetch + validate) or `jsonld` (paste). */
  url?: string;
  jsonld?: string;
}

export interface StartScanBody {
  url: string;
  pageLimit?: number;
}

export async function postScan(
  config: Config,
  body: StartScanBody,
): Promise<StartScanResponse> {
  return call<StartScanResponse>(config, {
    method: "POST",
    path: "/api/v1/scans",
    body,
    timeoutMs: config.getTimeoutMs,
  });
}

export async function getScan(config: Config, id: string): Promise<Scan> {
  return call<Scan>(config, {
    method: "GET",
    path: `/api/v1/scans/${encodeURIComponent(id)}`,
    timeoutMs: config.getTimeoutMs,
  });
}

export interface ListScansOptions {
  limit?: number;
  cursor?: string;
}

export async function listScans(
  config: Config,
  opts: ListScansOptions = {},
): Promise<ScanListResponse> {
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.cursor) params.set("cursor", opts.cursor);
  const query = params.toString();
  return call<ScanListResponse>(config, {
    method: "GET",
    path: `/api/v1/scans${query ? `?${query}` : ""}`,
    timeoutMs: config.getTimeoutMs,
  });
}

// POST /api/v1/scan/mcp is public (no API key required) — it connects to a live
// MCP endpoint and grades it. Synchronous (no polling). Sends the key only if
// present, like postAsk. Uses the longer scan timeout (the live handshake can
// take several seconds).
export async function scanMcp(
  config: Config,
  endpoint: string,
): Promise<McpScanResponse> {
  const url = `${config.baseUrl}/api/v1/scan/mcp`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ endpoint }),
      signal: AbortSignal.timeout(config.scanTimeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ApiError(
        "timeout",
        `Request to /api/v1/scan/mcp timed out after ${config.scanTimeoutMs}ms.`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      "network_error",
      `Network error calling /api/v1/scan/mcp: ${message}`,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      /* non-JSON body — surfaced via the error path below */
    }
  }

  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    const code = detail?.code ?? `http_${res.status}`;
    const message =
      (detail?.message ?? text) || `HTTP ${res.status} from /api/v1/scan/mcp`;
    throw new ApiError(code, message, res.status);
  }

  return payload as McpScanResponse;
}

// POST /api/v1/validate/structured-data is public (no API key required) — it
// validates JSON-LD from a URL or a pasted body and returns the D-series
// structured-data checks synchronously. Sends the key only if present, like
// scanMcp / postAsk.
export async function validateStructuredData(
  config: Config,
  input: ValidateInput,
): Promise<ValidateResult> {
  const path = "/api/v1/validate/structured-data";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  let res: Response;
  try {
    res = await fetch(`${config.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(config.getTimeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ApiError(
        "timeout",
        `Request to ${path} timed out after ${config.getTimeoutMs}ms.`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      "network_error",
      `Network error calling ${path}: ${message}`,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      /* non-JSON body — surfaced via the error path below */
    }
  }

  if (!res.ok) {
    const detail =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    const code = detail?.code ?? `http_${res.status}`;
    const message =
      (detail?.message ?? text) || `HTTP ${res.status} from ${path}`;
    throw new ApiError(code, message, res.status);
  }

  return payload as ValidateResult;
}

export interface AskOptions {
  q: string;
  itemType?: string;
  mode?: "list" | "summarize";
}

// POST /api/v1/ask is public (no API key required), and NLWeb returns an
// `_meta` envelope for both answers and failures — including NO_RESULTS (404)
// and RATE_LIMITED (429). So this has its own path rather than going through
// `call`: it doesn't require a key, sends one only if present, and passes the
// envelope through on 404/429 instead of throwing.
export async function postAsk(
  config: Config,
  opts: AskOptions,
): Promise<unknown> {
  const url = `${config.baseUrl}/api/v1/ask`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const payloadBody = {
    query: { q: opts.q, itemType: opts.itemType },
    prefer: opts.mode ? { mode: opts.mode } : undefined,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payloadBody),
      signal: AbortSignal.timeout(config.getTimeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      throw new ApiError(
        "timeout",
        `Request to /api/v1/ask timed out after ${config.getTimeoutMs}ms.`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new ApiError(
      "network_error",
      `Network error calling /api/v1/ask: ${message}`,
    );
  }

  const text = await res.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON — fall through to the error path below.
    }
  }

  // Answers and failures both carry `_meta`; surface the envelope as-is.
  if (payload && typeof payload === "object" && "_meta" in payload) {
    return payload;
  }
  if (!res.ok) {
    throw new ApiError(`http_${res.status}`, text || `HTTP ${res.status}`, res.status);
  }
  return payload;
}
