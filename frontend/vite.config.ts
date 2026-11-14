import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:9000",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Split the heavy chart library and React runtime into their own
    // long-lived cacheable chunks instead of one 670 kB bundle.
    rollupOptions: {
      output: {
        manualChunks: {
          react:    ["react", "react-dom", "@tanstack/react-query"],
          recharts: ["recharts"],
        },
      },
    },
  },
});
