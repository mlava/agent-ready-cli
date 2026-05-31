import { parseArgs } from "node:util";
import {
  ApiError,
  createConfig,
  getScan,
  listScans,
  postAsk,
  postScan,
  type Config,
  type Scan,
} from "./client.js";
import {
  formatAsk,
  formatQueued,
  formatScan,
  formatScanList,
  makePainter,
} from "./format.js";

export const VERSION = "0.1.0";

// Injection seam so tests can drive the CLI without real network or timers.
export interface IO {
  out: (s: string) => void;
  err: (s: string) => void;
  /** True when colour output is appropriate (stdout is a TTY, NO_COLOR unset). */
  color: boolean;
  /** Resolves after `ms`; tests pass an instant stub. */
  sleep: (ms: number) => Promise<void>;
}

export interface Api {
  postScan: typeof postScan;
  getScan: typeof getScan;
  listScans: typeof listScans;
  postAsk: typeof postAsk;
}

const realApi: Api = { postScan, getScan, listScans, postAsk };

const HELP = `agent-ready — scan any URL for AI-agent readability (agent-ready.dev)

USAGE
  agent-ready <command> [options]

COMMANDS
  scan <url>        Start a scan and wait for the result
  get <id>          Fetch a completed (or in-progress) scan by id
  list              List your recent scans
  ask <query...>    Natural-language search of Agent Ready's docs (no key needed)

GLOBAL OPTIONS
  --json            Output raw JSON instead of formatted text
  --api-key <key>   API key (overrides AGENT_READY_API_KEY)
  --base-url <url>  API base URL (overrides AGENT_READY_API_URL)
  --no-color        Disable coloured output
  -h, --help        Show this help
  -v, --version     Show version

SCAN OPTIONS
  --page-limit <n>  Max pages to crawl
  --no-wait         Queue the scan and print its id without polling
  --poll-interval <s>  Seconds between status polls (default 2)
  --timeout <s>     Max seconds to wait for completion (default 120)

LIST OPTIONS
  --limit <n>       Number of scans to return (1–100, default 20)
  --cursor <iso>    Pagination cursor (nextCursor from a prior response)

ASK OPTIONS
  --mode <list|summarize>   Result style
  --type <itemType>         Restrict to: methodology | checks | specs | llms-txt | check

AUTH
  scan, get, and list need a Pro API key — get one at
  https://agent-ready.dev/dashboard/api-keys. ask is public.

EXAMPLES
  agent-ready scan https://example.com
  agent-ready scan https://example.com --json --page-limit 25
  agent-ready get V1StGXR8_Z
  agent-ready list --limit 5
  agent-ready ask "how is the score calculated?"
`;

interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

function parse(argv: string[]): ParsedArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      json: { type: "boolean" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      "no-color": { type: "boolean" },
      "no-wait": { type: "boolean" },
      "page-limit": { type: "string" },
      "poll-interval": { type: "string" },
      timeout: { type: "string" },
      limit: { type: "string" },
      cursor: { type: "string" },
      mode: { type: "string" },
      type: { type: "string" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  return { values, positionals } as ParsedArgs;
}

function resolveConfig(
  env: NodeJS.ProcessEnv,
  values: ParsedArgs["values"],
): Config {
  const config = createConfig(env);
  if (typeof values["api-key"] === "string") config.apiKey = values["api-key"];
  if (typeof values["base-url"] === "string") {
    config.baseUrl = values["base-url"].replace(/\/+$/, "");
  }
  if (typeof values.timeout === "string") {
    const secs = Number(values.timeout);
    if (Number.isFinite(secs) && secs > 0) config.scanTimeoutMs = secs * 1000;
  }
  return config;
}

function intOption(
  raw: string | boolean | undefined,
  name: string,
): number | undefined {
  if (typeof raw !== "string") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError("invalid_request", `--${name} must be a positive integer.`);
  }
  return n;
}

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv,
  io: IO,
  api: Api = realApi,
): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parse(argv);
  } catch (err) {
    io.err(`Error: ${err instanceof Error ? err.message : String(err)}`);
    io.err("Run `agent-ready --help` for usage.");
    return 2;
  }

  const { values, positionals } = parsed;
  const command = positionals[0];

  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  if (values.help || !command) {
    io.out(HELP);
    return command ? 0 : values.help ? 0 : 1;
  }

  const color = io.color && !values["no-color"];
  const paint = makePainter(color);
  const json = Boolean(values.json);

  try {
    switch (command) {
      case "scan":
        return await cmdScan(positionals.slice(1), values, env, io, api, json, paint);
      case "get":
        return await cmdGet(positionals.slice(1), values, env, io, api, json, paint);
      case "list":
        return await cmdList(values, env, io, api, json, paint);
      case "ask":
        return await cmdAsk(positionals.slice(1), values, env, io, api, json, paint);
      default:
        io.err(`Unknown command: ${command}`);
        io.err("Run `agent-ready --help` for usage.");
        return 2;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      io.err(`Error (${err.code}): ${err.message}`);
      return 1;
    }
    io.err(`Error: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function cmdScan(
  args: string[],
  values: ParsedArgs["values"],
  env: NodeJS.ProcessEnv,
  io: IO,
  api: Api,
  json: boolean,
  paint: ReturnType<typeof makePainter>,
): Promise<number> {
  const url = args[0];
  if (!url) {
    io.err("Usage: agent-ready scan <url> [--page-limit n] [--no-wait]");
    return 2;
  }
  const config = resolveConfig(env, values);
  const pageLimit = intOption(values["page-limit"], "page-limit");

  const queued = await api.postScan(config, { url, pageLimit });

  if (values["no-wait"]) {
    if (json) io.out(JSON.stringify(queued, null, 2));
    else io.out(formatQueued(queued.id, queued.url, paint));
    return 0;
  }

  const pollSecs = intOption(values["poll-interval"], "poll-interval") ?? 2;
  const deadline = Date.now() + config.scanTimeoutMs;

  if (!json) io.err(paint("gray", `Scanning ${url}…`));

  let scan: Scan = await api.getScan(config, queued.id);
  while (scan.status === "running") {
    if (Date.now() >= deadline) {
      io.err(
        `Timed out waiting for scan ${queued.id} after ${Math.round(
          config.scanTimeoutMs / 1000,
        )}s. It may still finish — try \`agent-ready get ${queued.id}\`.`,
      );
      return 1;
    }
    await io.sleep(pollSecs * 1000);
    scan = await api.getScan(config, queued.id);
  }

  if (scan.status === "failed") {
    io.err(`Scan ${queued.id} failed.`);
    if (json) io.out(JSON.stringify(scan, null, 2));
    return 1;
  }

  if (json) io.out(JSON.stringify(scan, null, 2));
  else io.out(formatScan(scan, paint));
  return 0;
}

async function cmdGet(
  args: string[],
  values: ParsedArgs["values"],
  env: NodeJS.ProcessEnv,
  io: IO,
  api: Api,
  json: boolean,
  paint: ReturnType<typeof makePainter>,
): Promise<number> {
  const id = args[0];
  if (!id) {
    io.err("Usage: agent-ready get <id>");
    return 2;
  }
  const config = resolveConfig(env, values);
  const scan = await api.getScan(config, id);
  if (json) io.out(JSON.stringify(scan, null, 2));
  else if (scan.status === "running")
    io.out(paint("yellow", `Scan ${id} is still running. Try again shortly.`));
  else io.out(formatScan(scan, paint));
  return 0;
}

async function cmdList(
  values: ParsedArgs["values"],
  env: NodeJS.ProcessEnv,
  io: IO,
  api: Api,
  json: boolean,
  paint: ReturnType<typeof makePainter>,
): Promise<number> {
  const config = resolveConfig(env, values);
  const limit = intOption(values.limit, "limit");
  const cursor = typeof values.cursor === "string" ? values.cursor : undefined;
  const res = await api.listScans(config, { limit, cursor });
  if (json) {
    io.out(JSON.stringify(res, null, 2));
    return 0;
  }
  io.out(formatScanList(res.data, paint));
  if (res.nextCursor) {
    io.out(paint("gray", `\nMore: agent-ready list --cursor ${res.nextCursor}`));
  }
  return 0;
}

async function cmdAsk(
  args: string[],
  values: ParsedArgs["values"],
  env: NodeJS.ProcessEnv,
  io: IO,
  api: Api,
  json: boolean,
  paint: ReturnType<typeof makePainter>,
): Promise<number> {
  const q = args.join(" ").trim();
  if (!q) {
    io.err('Usage: agent-ready ask "<question>"');
    return 2;
  }
  const config = resolveConfig(env, values);
  const mode =
    values.mode === "list" || values.mode === "summarize"
      ? values.mode
      : undefined;
  const itemType = typeof values.type === "string" ? values.type : undefined;
  const payload = await api.postAsk(config, { q, mode, itemType });
  if (json) io.out(JSON.stringify(payload, null, 2));
  else io.out(formatAsk(payload, paint));
  return 0;
}
