import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://low-crane-dronehacks.github.io/",
  vite: {
    optimizeDeps: {
      exclude: ["@rerun-io/web-viewer"],
    },
  },
});
