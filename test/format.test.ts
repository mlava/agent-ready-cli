import { describe, expect, it } from "vitest";
import {
  formatAsk,
  formatQueued,
  formatScan,
  formatScanList,
  makePainter,
} from "@/format";
import type { Scan } from "@/client";

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
  it("shows both scores", () => {
    expect(text).toContain("72/100");
    expect(text).toContain("40/100");
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
          pagesScanned: 3,
          createdAt: "2026-05-31T12:30:00.000Z",
        },
      ],
      plain,
    );
    expect(t).toContain("88");
    expect(t).toContain("example.com");
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
