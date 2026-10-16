import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";

if (!existsSync(new URL("../.dev.vars", import.meta.url))) {
  copyFileSync(
    new URL("../.dev.vars.example", import.meta.url),
    new URL("../.dev.vars", import.meta.url),
  );
}

const dist = new URL("../../web/dist/", import.meta.url);
if (!existsSync(dist)) {
  mkdirSync(dist, { recursive: true });
  writeFileSync(
    new URL("index.html", dist),
    "<!doctype html><meta charset=utf-8><title>Poker</title><p>Compila la web con pnpm build o usa el servidor de Vite.</p>",
  );
}
