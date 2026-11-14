import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Static data: served from frontend/public/data when ./start.sh built it
      // locally; otherwise fall back to the published GitHub Pages data set.
      ...(process.env.VITE_USE_REMOTE_DATA
        ? { "/data": { target: "https://naveenrod.github.io/Crypto-stock-webpage", changeOrigin: true } }
        : {}),
      // Live quotes + news are Vercel functions (frontend/api). In dev, proxy
      // them to the deployed site, or run `npx vercel dev` instead of `vite`.
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "https://crypto-stock-webpage.vercel.app",
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
