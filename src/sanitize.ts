/**
 * Neutralise terminal escape sequences in text that came from the API.
 *
 * Scan results quote content from the scanned website (its <title>, llms.txt
 * headings, header values). The CLI prints that to the operator's terminal,
 * so a hostile site could otherwise plant OSC 52 (clipboard write), CSI 2J
 * (clear screen), a carriage return that overwrites a line, or bidi overrides
 * — CWE-150, reported 2026-11-03. The server strips these too; this is the
 * sink-side defence for older stored scans and any other API host.
 *
 * Kept: \n and \t. Removed: whole ESC/C1 sequences and every other C0/C1
 * control, DEL, and Unicode bidi override/isolate characters.
 */

const ESCAPE_SEQUENCE = new RegExp(
  [
    "(?:\\u001B[\\]PX^_]|[\\u0090\\u0098\\u009D\\u009E\\u009F])[\\s\\S]*?(?:\\u0007|\\u001B\\\\|\\u009C|$)",
    "(?:\\u001B\\[|\\u009B)[\\u0030-\\u003F]*[\\u0020-\\u002F]*[\\u0040-\\u007E]?",
    "\\u001B[\\u0020-\\u002F]*[\\u0030-\\u007E]?",
  ].join("|"),
  "g",
);

const CONTROL_CHARS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

export function stripTerminalEscapes(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(ESCAPE_SEQUENCE, "")
    .replace(CONTROL_CHARS, "");
}

/** Deep-sanitise every string (values and keys) in a parsed JSON payload. */
export function sanitizePayload(value: unknown): unknown {
  if (typeof value === "string") return stripTerminalEscapes(value);
  if (Array.isArray(value)) return value.map(sanitizePayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[stripTerminalEscapes(k)] = sanitizePayload(v);
    }
    return out;
  }
  return value;
}

/** JSON.parse that returns a payload with every string sanitised. */
export function parseSanitized(text: string): unknown {
  return sanitizePayload(JSON.parse(text));
}
