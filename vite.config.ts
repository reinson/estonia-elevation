import { defineConfig } from "vite";

/**
 * VITE_BASE_PATH is set by the GitHub Actions workflow to /<repo-name>/
 * so that all asset URLs resolve correctly under the GitHub Pages sub-path.
 * When running locally with `npm run dev` it defaults to "/" (root).
 */
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
});
