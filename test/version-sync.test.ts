import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/cli.js";

/**
 * `agent-ready --version` prints src/cli.ts VERSION, but npm publishes
 * package.json version. Nothing tied the two together, and they drifted:
 * 0.5.2 shipped reporting 0.5.1. A wrong --version misdirects every bug
 * report, so pin them together the way the MCP package already does.
 */
describe("version surfaces", () => {
  it("keeps the printed VERSION in sync with the published package version", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };

    expect(
      VERSION,
      `src/cli.ts VERSION is ${VERSION} but package.json is ${pkg.version}`,
    ).toBe(pkg.version);
  });
});
