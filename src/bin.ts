import { run, type IO } from "./cli.js";

const io: IO = {
  out: (s) => process.stdout.write(s.endsWith("\n") ? s : `${s}\n`),
  err: (s) => process.stderr.write(s.endsWith("\n") ? s : `${s}\n`),
  // Colour when stdout is a TTY and NO_COLOR is unset (https://no-color.org).
  color: process.stdout.isTTY === true && !process.env.NO_COLOR,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  },
};

run(process.argv.slice(2), process.env, io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(
      `Fatal: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
