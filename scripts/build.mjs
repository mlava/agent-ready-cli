import { build } from "esbuild";

await build({
  entryPoints: ["src/bin.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "dist/cli.mjs",
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});

process.stdout.write("Built dist/cli.mjs\n");
