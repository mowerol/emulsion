/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import process from "node:process";
import { builtinLooks } from "./tools/vite/builtin-looks";
import { devTrace } from "./tools/vite/devtrace";
import { buildId, sourcemaps } from "./tools/vite/sourcemaps";
import { readFileSync } from "node:fs";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => {
  const build = buildId(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version);
  return {
    plugins: [react(), builtinLooks(), devTrace(), sourcemaps(build)],
    define: { __EMULSION_BUILD__: JSON.stringify(build) },
    test: { environment: "node", include: ["src/**/*.test.ts"] },

    // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
    //
    // 1. prevent Vite from obscuring rust errors
    clearScreen: false,
    // 2. tauri expects a fixed port, fail if that port is not available
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host
        ? {
            protocol: "ws",
            host,
            port: 1421,
          }
        : undefined,
      watch: {
        // 3. tell Vite to ignore watching `src-tauri`
        ignored: ["**/src-tauri/**"],
      },
    },
  };
});
