import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
  /**
   * GitHub Pages serves the site from `/<repo>/`, not from the domain root, so
   * asset URLs need that prefix. It is injected by CI (`PAGES_BASE`) rather
   * than hardcoded, because setting it unconditionally would also move the
   * local dev server to `/noxstream/` and break `npm run dev` for everyone.
   */
  base: process.env.PAGES_BASE ?? "/",
  plugins: [react()],
  resolve: {
    alias: {
      // packages/shared is the single source of truth for Nox constants and
      // domain types. We alias into its TS source rather than copying values.
      "@shared": fileURLToPath(new URL("../shared/src", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  /**
   * We compile `packages/shared/src/*.ts` directly (aliased as `@shared`), and
   * esbuild would otherwise pick up that package's own tsconfig.json — which
   * `extends "@tsconfig/node22/tsconfig.json"`, a dependency that resolves from
   * packages/contracts but not from packages/shared (it has no node_modules of
   * its own).
   *
   * Passing `tsconfigRaw` as a STRING makes Vite skip tsconfig discovery
   * entirely; an object is merged on top of the discovered file, which still
   * requires resolving it. Building the frontend therefore never depends on
   * another package's dev dependencies being installed. Type checking is
   * unaffected — that is `tsc -p tsconfig.json`, which owns the real settings.
   */
  esbuild: {
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: "es2022",
        useDefineForClassFields: true,
        jsx: "react-jsx",
      },
    }),
  },
  server: {
    // ../shared/src and ../shared/deployments live outside this package root.
    fs: { allow: [monorepoRoot, here] },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
