// Human-readable rendering of API responses. Pure functions that take a
// `color` toggle and return strings, so they're trivial to unit-test without
// a TTY. The CLI decides whether colour is on (TTY + not NO_COLOR).

import type {
  CheckResult,
  CheckStatus,
  McpScanResponse,
  Scan,
  ScanSummary,
  ValidateResult,
  ValidateVerdict,
} from "./client.js";

const CODES = {
  reset: "[0m",
  bold: "[1m",
  dim: "[2m",
  red: "[31m",
  green: "[32m",
  yellow: "[33m",
  cyan: "[36m",
  gray: "[90m",
} as const;

export type Painter = (code: keyof typeof CODES, text: string) => string;

export function makePainter(enabled: boolean): Painter {
  if (!enabled) return (_code, text) => text;
  return (code, text) => `${CODES[code]}${text}${CODES.reset}`;
}

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: "✔",
  fail: "✘",
  warn: "▲",
  error: "✘",
};

const STATUS_COLOR: Record<CheckStatus, keyof typeof CODES> = {
  pass: "green",
  fail: "red",
  warn: "yellow",
  error: "red",
};

function scoreColor(score: number): keyof typeof CODES {
  if (score >= 80) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

/**
 * "Better than X% of N sites scanned" — mirrors agent-ready.dev's benchmarkLabel
 * so the CLI quotes the same number the score card and widget do. Returns null
 * when the corpus is too thin to quote (the API sends null fields).
 */
export function formatBenchmark(
  percentile: number | null | undefined,
  corpusTotal: number | null | undefined,
): string | null {
  if (percentile == null || corpusTotal == null) return null;
  const n = corpusTotal.toLocaleString("en-GB");
  if (percentile >= 100) return `Better than all ${n} sites scanned`;
  if (percentile <= 0) return `Among the lowest of ${n} sites scanned`;
  return `Better than ${percentile}% of ${n} sites scanned`;
}

/** Full scan result: scores, then every non-passing check grouped by section. */
export function formatScan(scan: Scan, paint: Painter): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `${paint("bold", scan.rootUrl)}  ${paint("gray", `(${scan.id})`)}`,
  );
  lines.push("");
  lines.push(
    `  Vercel readability   ${paint(
      scoreColor(scan.vercelScore),
      `${scan.vercelScore}/100`,
    )}  ${paint("gray", scan.vercelRating.replace(/_/g, " "))}`,
  );
  const benchmark = formatBenchmark(scan.percentile, scan.corpusTotal);
  if (benchmark) {
    lines.push(paint("gray", `  ${benchmark}`));
  }
  lines.push(
    `  llms.txt             ${paint(
      scoreColor(scan.llmstxtScore),
      `${scan.llmstxtScore}/100`,
    )}`,
  );
  lines.push(
    paint(
      "gray",
      `  ${scan.pagesScanned}/${scan.pagesDiscovered} pages scanned`,
    ),
  );

  const sections: [string, CheckResult[]][] = [
    ["Site checks", scan.siteChecks],
    ["llms.txt checks", scan.llmstxtChecks],
  ];

  for (const [title, checks] of sections) {
    const failed = checks.filter(
      (c) => c.status === "fail" || c.status === "error" || c.status === "warn",
    );
    if (failed.length === 0) continue;
    lines.push("");
    lines.push(paint("bold", `  ${title} — ${failed.length} need attention`));
    for (const c of failed) {
      lines.push(formatCheckLine(c, paint));
    }
  }

  const totalIssues =
    countNonPassing(scan.siteChecks) + countNonPassing(scan.llmstxtChecks);
  lines.push("");
  if (totalIssues === 0) {
    lines.push(paint("green", "  All checks passed. 🎉"));
  } else {
    lines.push(
      paint("gray", `  ${totalIssues} check(s) need attention. `) +
        paint("cyan", `https://agent-ready.dev/scan/${scan.shareToken}`),
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** Full MCP server scan: score, server metadata, then non-passing checks. */
export function formatMcpScan(res: McpScanResponse, paint: Painter): string {
  const scan = res.scan;
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `${paint("bold", scan.endpoint)}  ${paint("gray", `(${scan.id})`)}`,
  );
  lines.push("");

  if (scan.status === "failed") {
    lines.push(`  ${paint("red", "Could not scan this server.")}`);
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    `  MCP score   ${paint(
      scoreColor(scan.mcpScore),
      `${scan.mcpScore}/100`,
    )}  ${paint("gray", scan.mcpRating.replace(/_/g, " "))}`,
  );
  lines.push(
    paint(
      "gray",
      `  ${scan.serverName ?? "unknown server"}${
        scan.serverVersion ? ` v${scan.serverVersion}` : ""
      } · ${scan.toolCount ?? 0} tools · ${scan.resourceCount ?? 0} resources · ${scan.promptCount ?? 0} prompts`,
    ),
  );

  // Informational/not-applicable checks (e.g. auth, no-UI) are hidden from the
  // issue list; show the graded checks that didn't pass.
  const graded = scan.checks.filter((c) => c.details?.notApplicable !== true);
  const failed = graded.filter((c) => c.status !== "pass");
  if (failed.length > 0) {
    lines.push("");
    lines.push(
      paint("bold", `  MCP server quality — ${failed.length} need attention`),
    );
    for (const c of failed) lines.push(formatCheckLine(c, paint));
  }

  lines.push("");
  if (failed.length === 0) {
    lines.push(paint("green", "  All checks passed. 🎉"));
  } else {
    lines.push(paint("cyan", `  https://agent-ready.dev${res.shareUrl}`));
  }
  lines.push("");
  return lines.join("\n");
}

const VERDICT_COLOR: Record<ValidateVerdict, keyof typeof CODES> = {
  "agent-ready": "green",
  "needs-work": "yellow",
  "not-agent-readable": "red",
};

/** Structured-data validation result: verdict, tallies, then non-passing checks. */
export function formatValidate(result: ValidateResult, paint: Painter): string {
  const lines: string[] = [];
  const target =
    result.mode === "url" ? (result.url ?? "(url)") : "pasted JSON-LD";
  const { pass, warn, fail, verdict } = result.summary;
  lines.push("");
  lines.push(`${paint("bold", target)}  ${paint("gray", `(${result.mode})`)}`);
  lines.push("");
  lines.push(
    `  ${paint(VERDICT_COLOR[verdict], verdict.replace(/-/g, " "))}  ${paint(
      "gray",
      `${pass} pass · ${warn} warn · ${fail} fail`,
    )}`,
  );

  const issues = result.checks.filter((c) => c.status !== "pass");
  lines.push("");
  if (issues.length === 0) {
    lines.push(paint("green", "  All structured-data checks passed. 🎉"));
  } else {
    lines.push(
      paint("bold", `  Structured data — ${issues.length} need attention`),
    );
    for (const c of issues) lines.push(formatCheckLine(c, paint));
  }
  lines.push("");
  return lines.join("\n");
}

function formatCheckLine(c: CheckResult, paint: Painter): string {
  const icon = paint(STATUS_COLOR[c.status], STATUS_ICON[c.status]);
  const id = paint("gray", c.checkId.padEnd(4));
  return `    ${icon} ${id} ${c.name}${c.message ? paint("dim", ` — ${c.message}`) : ""}`;
}

function countNonPassing(checks: CheckResult[]): number {
  return checks.filter((c) => c.status !== "pass").length;
}

/** A queued-scan acknowledgement (used by `scan --no-wait`). */
export function formatQueued(
  id: string,
  url: string,
  paint: Painter,
): string {
  return [
    `${paint("green", "✔")} Scan queued for ${paint("bold", url)}`,
    `  id:   ${id}`,
    paint("gray", `  poll: agent-ready get ${id}`),
  ].join("\n");
}

/** Tabular `list` output. */
export function formatScanList(rows: ScanSummary[], paint: Painter): string {
  if (rows.length === 0) {
    return paint("gray", "No scans yet. Run `agent-ready scan <url>` to start one.");
  }
  const lines = rows.map((r) => {
    const score =
      r.vercelScore === null
        ? paint("gray", " --")
        : paint(scoreColor(r.vercelScore), String(r.vercelScore).padStart(3));
    const id = paint("gray", r.id.padEnd(12));
    const when = paint("dim", formatDate(r.createdAt));
    return `  ${score}  ${id} ${r.domain}  ${when}`;
  });
  return [paint("bold", "  score  id           domain  created"), ...lines].join(
    "\n",
  );
}

function formatDate(iso: string): string {
  // Keep it terminal-friendly: YYYY-MM-DD HH:MM (UTC). Avoid locale surprises.
  return iso.replace("T", " ").replace(/:\d\d\.\d+Z$/, "Z").slice(0, 16);
}

/**
 * Render an NLWeb /ask envelope for humans. The envelope shape is loosely
 * typed (it's pass-through), so we read defensively and fall back to JSON
 * when the structure isn't what we expect.
 */
export function formatAsk(payload: unknown, paint: Painter): string {
  if (!payload || typeof payload !== "object") {
    return JSON.stringify(payload, null, 2);
  }
  const obj = payload as Record<string, unknown>;
  const meta = (obj._meta ?? {}) as Record<string, unknown>;
  const results = Array.isArray(obj.results) ? obj.results : [];

  // Failure envelope (NO_RESULTS / RATE_LIMITED / etc.) carries a message.
  const metaMessage =
    typeof meta.message === "string" ? meta.message : undefined;
  if (results.length === 0) {
    return paint("yellow", metaMessage ?? "No results.");
  }

  const lines: string[] = [];
  for (const r of results) {
    if (!r || typeof r !== "object") continue;
    const item = r as Record<string, unknown>;
    const name = typeof item.name === "string" ? item.name : "(untitled)";
    const url = typeof item.url === "string" ? item.url : "";
    const desc =
      typeof item.description === "string" ? item.description : "";
    lines.push(paint("bold", `• ${name}`));
    if (url) lines.push(paint("cyan", `  ${url}`));
    if (desc) lines.push(paint("dim", `  ${desc}`));
  }
  return lines.join("\n");
}
