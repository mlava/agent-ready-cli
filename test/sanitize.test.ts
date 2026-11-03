import { afterEach, describe, expect, it, vi } from "vitest";
import { stripTerminalEscapes, sanitizePayload } from "@/sanitize";
import { ApiError, getScan, postAsk, type Config } from "@/client";

const ESC = "\u001b";
const BEL = "\u0007";
// The reported payload: OSC 52 clipboard write + CSI 2J clear screen.
const OSC52 = `${ESC}]52;c;${Buffer.from("rm -rf ~/.ssh").toString("base64")}${BEL}`;
const CLEAR = `${ESC}[2J`;
const DANGEROUS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202a-\u202e\u2066-\u2069]/;

const config: Config = {
  baseUrl: "https://agent-ready.dev",
  apiKey: "ar_live_test",
  scanTimeoutMs: 1000,
  getTimeoutMs: 1000,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stripTerminalEscapes", () => {
  it("removes OSC 52 and CSI sequences whole", () => {
    expect(stripTerminalEscapes(`Acme${OSC52}${CLEAR} Home`)).toBe("Acme Home");
  });

  it("handles ST, C1, DCS, unterminated and two-byte sequences", () => {
    expect(stripTerminalEscapes(`a${ESC}]0;t${ESC}\\b`)).toBe("ab");
    expect(stripTerminalEscapes("a\u009b31mb")).toBe("ab");
    expect(stripTerminalEscapes(`a${ESC}Pq${ESC}\\b`)).toBe("ab");
    expect(stripTerminalEscapes(`a${ESC}]52;c;AAAA`)).toBe("a");
    expect(stripTerminalEscapes(`a${ESC}cb`)).toBe("ab");
  });

  it("strips CR/DEL/NUL/bidi, keeps \\n \\t and normal Unicode", () => {
    expect(stripTerminalEscapes("ok\rX\u007f\u0000\u202e\ty\nCafé ✓")).toBe("ok\nX\ty\nCafé ✓");
  });

  it("deep-sanitises payloads", () => {
    expect(sanitizePayload({ a: [`x${CLEAR}`, 1, null], b: { c: `y${BEL}` } })).toEqual({
      a: ["x", 1, null],
      b: { c: "y" },
    });
  });
});

describe("client responses are sanitised before anything prints them", () => {
  it("getScan strips escapes that arrive JSON-encoded (\\u001b) in a check message", async () => {
    const body = {
      id: "s1",
      rootUrl: "https://evil.test",
      status: "completed",
      siteChecks: [
        { checkId: "A10", name: "Title", status: "pass", message: `Page title: "Acme${OSC52}${CLEAR}"`, howToFix: null },
      ],
    };
    // JSON.stringify encodes ESC as \u001b — the form it really arrives in.
    const raw = JSON.stringify(body);
    expect(raw).toContain("\\u001b");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(raw, { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    const scan = (await getScan(config, "s1")) as unknown as { siteChecks: { message: string }[] };
    expect(scan.siteChecks[0].message).toBe('Page title: "Acme"');
  });

  it("error messages built from a raw non-JSON body are sanitised", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`bad gateway${CLEAR}${OSC52}`, { status: 502 }),
    );
    const err = await getScan(config, "s1").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).not.toMatch(DANGEROUS);
  });

  it("postAsk envelopes are sanitised", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ _meta: { response_type: "list" }, results: [{ name: `n${CLEAR}`, description: `d${OSC52}` }] }),
        { status: 200 },
      ),
    );
    const out = JSON.stringify(await postAsk(config, { q: "q" }));
    expect(out).not.toMatch(/\\u00(1b|07|9b)/i);
  });
});
