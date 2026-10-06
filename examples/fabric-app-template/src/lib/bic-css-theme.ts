// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
// The resolved Fabric theme from the page's CSS, kept current - the same logic as @microsoft/fabric-visuals' useCssTheme
// (MIT), on @microsoft/fabric-visuals-core alone, so reading the theme doesn't bundle Vega.
import { useSyncExternalStore } from "react";
import { readCssTheme, cssThemeChanged, type VisualTheme } from "@microsoft/fabric-visuals-core";

const listeners = new Set<() => void>();
let cached: VisualTheme | undefined;
let stop: (() => void) | undefined;

function current(): VisualTheme {
  if (cached === undefined) cached = readCssTheme();
  return cached;
}

function recompute() {
  const next = readCssTheme();
  if (cached === undefined || cssThemeChanged(cached, next)) {
    cached = next;
    listeners.forEach((l) => l());
  }
}

function watch(): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(recompute);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-appearance"] });
  observer.observe(document.head, { subtree: true, childList: true, characterData: true });
  const queries = ["(prefers-color-scheme: dark)", "(forced-colors: active)", "(prefers-contrast: more)"]
    .map((q) => window.matchMedia?.(q)).filter((m): m is MediaQueryList => !!m);
  queries.forEach((m) => m.addEventListener("change", recompute));
  return () => { observer.disconnect(); queries.forEach((m) => m.removeEventListener("change", recompute)); };
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) stop = watch();
  listeners.add(listener);
  recompute();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stop?.(); stop = undefined; }
  };
}

export function useCssTheme(): VisualTheme {
  return useSyncExternalStore(subscribe, current, current);
}
