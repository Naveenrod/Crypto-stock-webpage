/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:       "#080d1a",
        surface:  "#0f1628",
        card:     "#141c30",
        border:   "#1e2a42",
        accent:   "#6366f1",
        success:  "#22c55e",
        danger:   "#ef4444",
        warning:  "#f59e0b",
        muted:    "#64748b",
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
    },
  },
  plugins: [],
};
