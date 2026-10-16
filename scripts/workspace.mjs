import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const localPnpm = join(root, ".tools/node_modules/.bin/pnpm");
const pnpm = existsSync(localPnpm) ? localPnpm : "pnpm";
const [script, ...args] = process.argv.slice(2);
const result = spawnSync(pnpm, [script, ...args], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    PATH: `${dirname(localPnpm)}:${join(root, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
  },
});
process.exit(result.status ?? 1);
