/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

export default {
  darkMode: ["selector", '[data-theme="dark"]'],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      token("--c-bg"),
        surface: token("--c-surface"),
        card:    token("--c-card"),
        border:  token("--c-border"),
        fg:      token("--c-text"),      // primary text
        fg2:     token("--c-text2"),     // secondary text
        muted:   token("--c-muted"),
        accent:  token("--c-accent"),
        success: token("--c-success"),
        danger:  token("--c-danger"),
        warning: token("--c-warning"),
      },
      fontFamily: {
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      screens: {
        xs: "420px",
      },
    },
  },
  plugins: [],
};
