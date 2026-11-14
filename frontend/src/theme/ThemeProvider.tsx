import { createContext, useCallback, useContext, useMemo, useState, ReactNode } from "react";

export type Theme = "light" | "dark";
const STORAGE_KEY = "finsight-theme";

interface ThemeCtxValue { theme: Theme; toggle: () => void; setTheme: (t: Theme) => void }
const ThemeCtx = createContext<ThemeCtxValue>({ theme: "light", toggle: () => {}, setTheme: () => {} });

function readStored(): Theme {
  try { return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; }
}

/** Apply synchronously so children that read CSS variables during render see the new palette. */
function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(STORAGE_KEY, theme); } catch { /* private mode */ }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "dark" ? "#0f1628" : "#ffffff");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => { const t = readStored(); apply(t); return t; });
  const setTheme = useCallback((t: Theme) => { apply(t); setThemeState(t); }, []);
  const toggle   = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);
  const value    = useMemo(() => ({ theme, toggle, setTheme }), [theme, toggle, setTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);

/**
 * Resolved colours for SVG / recharts props (presentation attributes can't
 * reliably use CSS variables). Recomputed whenever the theme flips.
 */
export function useChartColors() {
  const { theme } = useTheme();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const c = (name: string) => `rgb(${css.getPropertyValue(name).trim() || "100 116 139"})`;
    return {
      grid:    c("--c-chart-grid"),
      axis:    c("--c-muted"),
      text:    c("--c-text"),
      muted:   c("--c-muted"),
      accent:  c("--c-accent"),
      success: c("--c-success"),
      danger:  c("--c-danger"),
      warning: c("--c-warning"),
      volume:  c("--c-volume"),
      card:    c("--c-card"),
      border:  c("--c-border"),
      theme,
    };
  }, [theme]);
}
