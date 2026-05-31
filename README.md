# agent-ready-cli

Command-line client for [Agent Ready](https://agent-ready.dev) — scan any URL for **AI-agent readability** against the Vercel Agent Readability Spec, the [llmstxt.org](https://llmstxt.org) standard, and agent-protocol manifests (MCP server cards, A2A, `agents.json`, `agent-permissions.json`, UCP, x402, NLWeb).

It's a thin wrapper over the hosted [agent-ready.dev REST API](https://agent-ready.dev/api/v1/openapi.json) — no scanning happens locally. For tool-native access from an AI assistant, see [`agent-ready-mcp`](https://github.com/mlava/agent-ready-mcp) instead.

## Install

```bash
npm install -g agent-ready
```

Or run without installing:

```bash
npx agent-ready scan https://example.com
```

Requires Node.js ≥ 20.10.

## Authentication

`scan`, `get`, and `list` require a **Pro API key**. Issue one from the
[dashboard](https://agent-ready.dev/dashboard/api-keys), then either:

```bash
export AGENT_READY_API_KEY="ar_live_..."
# or pass per-command:
agent-ready scan https://example.com --api-key ar_live_...
```

`ask` is public and needs no key.

## Commands

### `scan <url>`

Starts a scan, polls until it finishes, and prints a readability summary.

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
| `AGENT_READY_API_KEY` | — | Pro API key for `scan`/`get`/`list` |
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
