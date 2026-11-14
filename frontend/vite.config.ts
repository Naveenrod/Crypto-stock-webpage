import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Static data: served from frontend/public/data when ./start.sh built it
      // locally; set VITE_USE_REMOTE_DATA=1 to use the published data branch instead.
      ...(process.env.VITE_USE_REMOTE_DATA
        ? { "/data": { target: "https://raw.githubusercontent.com", changeOrigin: true,
                       rewrite: (p: string) => p.replace(/^\/data/, "/Naveenrod/Crypto-stock-webpage/data/data") } }
        : {}),
      // Live quotes + news are Vercel functions (frontend/api). In dev, proxy
      // them to the deployed site, or run `npx vercel dev` instead of `vite`.
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "https://www.crypto-fininsight.xyz",
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
