// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
// Light or dark for the whole app: the host's choice (Fabric's data-appearance on <html>, else the OS setting) until
// the reader picks, then the reader's pick for the rest of the session. It sets the `dark` class on <html>, which the
// template's tokens (and so every chart, through the theme bridge) follow.
import { useEffect, useSyncExternalStore } from "react";

export type ThemePick = "light" | "dark";
const KEY = "bic-theme";
const listeners = new Set<() => void>();
let pick: ThemePick | null = readPick();
let stop: (() => void) | undefined;

function readPick(): ThemePick | null {
  try { const v = sessionStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch { return null; }
}

/** What the host says: Fabric's data-appearance on <html>, else the OS setting. */
export function hostIsDark(): boolean {
  if (typeof document === "undefined") return false;
  const a = document.documentElement.getAttribute("data-appearance");
  if (a === "dark") return true;
  if (a === "light") return false;
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}

function isDarkNow(): boolean { return pick ? pick === "dark" : hostIsDark(); }
function apply() { if (typeof document !== "undefined") document.documentElement.classList.toggle("dark", isDarkNow()); }
function notify() { apply(); listeners.forEach((l) => l()); }

function watch(): () => void {
  if (typeof document === "undefined") return () => {};
  // data-appearance only: the class this hook sets itself must never be read back as the host's choice.
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-appearance"] });
  const os = window.matchMedia?.("(prefers-color-scheme: dark)");
  os?.addEventListener("change", notify);
  return () => { observer.disconnect(); os?.removeEventListener("change", notify); };
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) stop = watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { stop?.(); stop = undefined; }
  };
}

/** The reader's pick (kept for the session), or null to follow the host again. */
export function setThemePick(next: ThemePick | null): void {
  pick = next;
  try { if (next) sessionStorage.setItem(KEY, next); else sessionStorage.removeItem(KEY); } catch { /* private mode: kept in memory */ }
  notify();
}

/** { isDark, toggleTheme } - the template's ThemeContext shape - plus `picked`: whether the reader has chosen. */
export function useBicTheme() {
  const isDark = useSyncExternalStore(subscribe, isDarkNow, () => false);
  useEffect(apply, [isDark]);
  return { isDark, toggleTheme: () => setThemePick(isDarkNow() ? "light" : "dark"), picked: pick !== null };
}

/** The template's src/main.tsx calls useAppTheme(); setup points it here. */
export const useAppTheme = useBicTheme;
