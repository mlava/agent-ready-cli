import { describe, expect, it } from "vitest";
import {
  formatAsk,
  formatMcpScan,
  formatQueued,
  formatScan,
  formatScanList,
  formatValidate,
  makePainter,
} from "@/format";
import type { McpScanResponse, Scan, ValidateResult } from "@/client";

const plain = makePainter(false);
const colored = makePainter(true);

const scan: Scan = {
  id: "abc123",
  rootUrl: "https://example.com",
  status: "completed",
  createdAt: "2026-05-31T00:00:00.000Z",
  completedAt: "2026-05-31T00:01:00.000Z",
  pagesDiscovered: 4,
  pagesScanned: 4,
  vercelScore: 72,
  vercelRating: "good",
  llmstxtScore: 40,
  accessibilityScore: 88,
  siteChecks: [
    { checkId: "S1", name: "llms.txt exists", status: "pass", message: "", howToFix: null, details: {} },
    { checkId: "S2", name: "agents.md exists", status: "fail", message: "not found", howToFix: "add it", details: {} },
  ],
  llmstxtChecks: [],
  pageResults: [],
  shareToken: "abc123",
};

describe("makePainter", () => {
  it("is a no-op when disabled", () => {
    expect(plain("red", "hi")).toBe("hi");
  });
  it("wraps in ANSI codes when enabled", () => {
    expect(colored("red", "hi")).toContain("hi");
    expect(colored("red", "hi")).not.toBe("hi");
  });
});

describe("formatScan", () => {
  const text = formatScan(scan, plain);
  it("shows the vercel, llms.txt, and accessibility scores", () => {
    expect(text).toContain("72/100");
    expect(text).toContain("40/100");
    expect(text).toContain("Accessibility");
    expect(text).toContain("88/100");
  });
  it("lists failing checks but not passing ones", () => {
    expect(text).toContain("agents.md exists");
    expect(text).not.toContain("llms.txt exists");
  });
  it("includes the share link when issues remain", () => {
    expect(text).toContain("agent-ready.dev/scan/abc123");
  });
  it("celebrates a clean scan", () => {
    const clean = formatScan(
      { ...scan, siteChecks: [scan.siteChecks[0]!], llmstxtChecks: [] },
      plain,
    );
    expect(clean).toContain("All checks passed");
  });
  it("shows the corpus benchmark when the response carries one", () => {
    const benched = formatScan(
      { ...scan, percentile: 80, corpusTotal: 1234 },
      plain,
    );
    expect(benched).toContain("Better than 80% of 1,234 sites scanned");
  });
  it("omits the benchmark line on a thin corpus (null fields)", () => {
    const thin = formatScan(
      { ...scan, percentile: null, corpusTotal: null },
      plain,
    );
    expect(thin).not.toContain("sites scanned");
  });
  it("always ends with the weekly-monitoring nudge", () => {
    expect(text).toContain("Monitor this domain weekly");
    expect(text).toContain(
      "https://agent-ready.dev/pricing?utm_source=cli_cta",
    );
    // Present on a clean scan too — monitoring guards against regressions.
    const clean = formatScan(
      { ...scan, siteChecks: [scan.siteChecks[0]!], llmstxtChecks: [] },
      plain,
    );
    expect(clean).toContain("Monitor this domain weekly");
  });
});

describe("formatQueued", () => {
  it("prints id and a poll hint", () => {
    const t = formatQueued("abc123", "https://example.com", plain);
    expect(t).toContain("abc123");
    expect(t).toContain("agent-ready get abc123");
  });
});

describe("formatScanList", () => {
  it("handles the empty case", () => {
    expect(formatScanList([], plain)).toContain("No scans yet");
  });
  it("renders a row with score and domain", () => {
    const t = formatScanList(
      [
        {
          id: "x1",
          shareToken: "x1",
          domain: "example.com",
          rootUrl: "https://example.com",
          vercelScore: 88,
          vercelRating: "excellent",
          llmstxtScore: 80,
          accessibilityScore: 91,
          pagesScanned: 3,
          createdAt: "2026-05-31T12:30:00.000Z",
        },
      ],
      plain,
    );
    expect(t).toContain("88");
    expect(t).toContain("example.com");
    // Accessibility column is present in the header and the row value.
    expect(t).toContain("a11y");
    expect(t).toContain("91");
  });
});

describe("formatMcpScan", () => {
  const base: McpScanResponse = {
    scan: {
      id: "m1",
      shareToken: "m1",
      endpoint: "https://mcp.example.com/mcp",
      host: "mcp.example.com",
      status: "completed",
      mcpScore: 92,
      mcpRating: "excellent",
      serverName: "Example",
      serverVersion: "1.0.0",
      toolCount: 3,
      resourceCount: 0,
      promptCount: 0,
      checks: [
        { checkId: "M1", name: "Handshake", status: "pass", message: "", howToFix: null, details: {} },
        { checkId: "M2", name: "Server metadata", status: "warn", message: "3/6 fields", howToFix: "add", details: {} },
        { checkId: "M11", name: "Authentication", status: "warn", message: "none", howToFix: null, details: { notApplicable: true } },
      ],
    },
    shareUrl: "/mcp-server-scanner/m1",
  };

  it("shows score, server meta, and non-passing graded checks (hides N/A)", () => {
    const t = formatMcpScan(base, plain);
    expect(t).toContain("92/100");
    expect(t).toContain("Example v1.0.0");
    expect(t).toContain("Server metadata");
    expect(t).not.toContain("Authentication");
  });

  it("celebrates a clean scan", () => {
    const clean = formatMcpScan(
      { ...base, scan: { ...base.scan, checks: [base.scan.checks[0]!] } },
      plain,
    );
    expect(clean).toContain("All checks passed");
  });

  it("renders a failed scan", () => {
    const failed = formatMcpScan(
      { ...base, scan: { ...base.scan, status: "failed" } },
      plain,
    );
    expect(failed).toContain("Could not scan");
  });
});

describe("formatAsk", () => {
  it("renders result names and urls", () => {
    const t = formatAsk(
      { _meta: {}, results: [{ name: "Scoring", url: "https://x", description: "d" }] },
      plain,
    );
    expect(t).toContain("Scoring");
    expect(t).toContain("https://x");
  });
  it("shows the failure message when there are no results", () => {
    const t = formatAsk({ _meta: { message: "nothing found" }, results: [] }, plain);
    expect(t).toContain("nothing found");
  });
});

describe("formatValidate", () => {
  const base: ValidateResult = {
    mode: "url",
    url: "https://example.com/product",
    checks: [
      { checkId: "D1", name: "Valid JSON-LD", status: "pass", message: "ok", howToFix: null, details: {} },
      { checkId: "D3", name: "Required fields", status: "fail", message: "missing name", howToFix: "add name", details: {} },
    ],
    summary: { pass: 1, warn: 0, fail: 1, verdict: "needs-work" },
  };

  it("renders the verdict, tallies, and non-passing checks", () => {
    const t = formatValidate(base, plain);
    expect(t).toContain("https://example.com/product");
    expect(t).toContain("needs work");
    expect(t).toContain("1 pass · 0 warn · 1 fail");
    expect(t).toContain("D3");
    expect(t).not.toContain("D1"); // passing checks are hidden
  });

  it("celebrates a clean paste result", () => {
    const t = formatValidate(
      {
        mode: "paste",
        url: null,
        checks: [
          { checkId: "D1", name: "Valid JSON-LD", status: "pass", message: "", howToFix: null, details: {} },
        ],
        summary: { pass: 1, warn: 0, fail: 0, verdict: "agent-ready" },
      },
      plain,
    );
    expect(t).toContain("pasted JSON-LD");
    expect(t).toContain("All structured-data checks passed");
  });

  it("colourises the verdict", () => {
    const t = formatValidate(base, colored);
    expect(t).toContain("[33m"); // yellow for needs-work
  });
});
