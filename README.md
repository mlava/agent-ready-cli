# agent-ready-scanner

Command-line client for [Agent Ready](https://agent-ready.dev) — scan any URL for **AI-agent readability** against the Vercel Agent Readability Spec, the [llmstxt.org](https://llmstxt.org) standard, and agent-protocol manifests (MCP server cards, A2A, `agents.json`, `agent-permissions.json`, UCP, x402, NLWeb), plus a separate accessibility sub-score (WCAG 2.2 / layout stability).

It's a thin wrapper over the hosted [agent-ready.dev REST API](https://agent-ready.dev/api/v1/openapi.json) — no scanning happens locally. For tool-native access from an AI assistant, see [`agent-ready-mcp`](https://github.com/mlava/agent-ready-mcp) instead.

## Install

```bash
npm install -g agent-ready-scanner
```

This installs the `agent-ready` command. Or run without installing:

```bash
npx agent-ready-scanner scan https://example.com
```

> **Why `agent-ready-scanner`?** The bare `agent-ready` name is blocked by
> npm's package-name similarity policy (it collides with an unrelated
> `agentready` package). The installed command is still `agent-ready`.

Requires Node.js ≥ 20.10.

## Authentication

`scan` works **without a key** on the free anonymous tier — 3 scans per 30
days per IP, at 25-page depth:

```bash
npx agent-ready-scanner scan https://example.com   # no key, no account
```

A **Pro API key** unlocks 50 scans/month, 250-page depth, scan history
(`get`, `list`), and weekly monitoring. Issue one from the
[dashboard](https://agent-ready.dev/dashboard/api-keys), then either:

```bash
export AGENT_READY_API_KEY="ar_live_..."
# or pass per-command:
agent-ready scan https://example.com --api-key ar_live_...
```

`ask`, `mcp-scan`, and `validate-schema` are public and need no key.

## Commands

### `scan <url>`

Starts a scan, waits for it to finish, and prints a readability summary.
Keyless runs use the anonymous free tier (synchronous, 25 pages); with a Pro
key the scan runs on the deeper authenticated pipeline with polling.

```bash
agent-ready scan https://example.com
agent-ready scan https://example.com --page-limit 25
agent-ready scan https://example.com --no-wait      # queue only, print the id
agent-ready scan https://example.com --json         # raw JSON
```

| Option | Description |
| --- | --- |
| `--page-limit <n>` | Max pages to crawl |
| `--no-wait` | Queue the scan and print its id without polling |
| `--poll-interval <s>` | Seconds between status polls (default 2) |
| `--timeout <s>` | Max seconds to wait for completion (default 120) |

### `get <id>`

Fetch a scan by id (e.g. one started earlier with `--no-wait`).

```bash
agent-ready get V1StGXR8_Z
agent-ready get V1StGXR8_Z --json
```

### `list`

List your recent scans, newest first.

```bash
agent-ready list
agent-ready list --limit 5
agent-ready list --cursor 2026-05-30T00:00:00.000Z   # next page
```

### `ask <query...>`

Natural-language search over Agent Ready's own docs (methodology, the check
registry, supported specs). Public — no API key.

```bash
agent-ready ask "how is the score calculated?"
agent-ready ask "what does check S4 do?" --type checks
agent-ready ask "summarize the llms.txt requirements" --mode summarize
```

### `mcp-scan <endpoint>`

Connect to a live, remotely-hosted MCP server and grade its tools, resources,
and prompts against MCP best practices — returns a 0–100 MCP quality score with
a fix for each issue. Public — no API key. Great for CI (e.g. fail a build when
your server scores below a threshold). Remote http(s) endpoints only.

```bash
agent-ready mcp-scan https://mcp.example.com/mcp
agent-ready mcp-scan https://mcp.example.com/mcp --json
```

### `validate-schema <url|->`

Validate a page's JSON-LD structured data — schema lint plus the agent-coherence
checks the first-party validators (validator.schema.org, Rich Results Test)
don't do (freshness honesty, canonical/`.md` coherence, entity-name consistency,
extraction signal). Pass a URL to fetch and validate, or `-` to read a JSON-LD
string from stdin (paste mode — handy for validating JSON-LD an agent just
wrote, no deploy needed). Public — no API key. Exits non-zero when any check
fails, so it drops into CI.

```bash
agent-ready validate-schema https://example.com/product
cat page.jsonld | agent-ready validate-schema -
echo '{"@context":"https://schema.org","@type":"Product","name":"X"}' \
  | agent-ready validate-schema - --json
```

## Global options

| Option | Description |
| --- | --- |
| `--json` | Output raw JSON instead of formatted text |
| `--api-key <key>` | Override `AGENT_READY_API_KEY` |
| `--base-url <url>` | Override `AGENT_READY_API_URL` (e.g. for local dev) |
| `--no-color` | Disable coloured output ([`NO_COLOR`](https://no-color.org) is also honoured) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `AGENT_READY_API_KEY` | — | Pro API key — required for `get`/`list`, optional for `scan` (keyless runs on the anonymous tier) |
| `AGENT_READY_API_URL` | `https://agent-ready.dev` | API base URL |
| `AGENT_READY_SCAN_TIMEOUT_MS` | `120000` | Overall scan wait budget |
| `AGENT_READY_GET_TIMEOUT_MS` | `10000` | Per-request timeout |

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | API error, scan failed, or scan timed out |
| `2` | Usage error (bad arguments) |

`--json` output goes to stdout; progress and errors go to stderr, so you can
safely pipe JSON into other tools.

## Development

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
npm run build     # bundle to dist/cli.mjs
```

## License

MIT © Agent Ready
