// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useMemo } from "react";
import { useCssTheme } from "@/lib/bic-css-theme";

/**
 * Chart options from the app's resolved Fabric theme, so every chart follows light, dark and the host's palette.
 * Spread with the measured size: options={{ ...useBicChartOptions(), width, height }}. A change here restyles
 * the chart live; it never regenerates it.
 */
export function useBicChartOptions() {
  const theme = useCssTheme();
  return useMemo(() => ({
    palette: theme.categoricalPalette ? [...theme.categoricalPalette] : [],
    themeFg: theme.foreground,
    themeAccent: theme.brandForeground,
    backgroundColor: theme.background,
  }), [theme]);
}
