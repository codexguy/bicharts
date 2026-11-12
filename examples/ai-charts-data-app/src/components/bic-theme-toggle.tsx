// Added by the RegiaBI chart server (setup_fabric_app). Yours to edit; it is never rewritten.
import { useBicTheme } from "@/lib/bic-theme";

/**
 * The light/dark switch. Put it in the app's header, on every page: <BicThemeToggle />. It flips the whole app (and every
 * chart with it) and the reader's pick holds for the session; until they pick, the app follows Fabric, else the OS.
 */
export function BicThemeToggle({ className }: { className?: string }) {
  const { isDark, toggleTheme } = useBicTheme();
  return (
    // One state, said once: a fixed name with aria-pressed (a screen reader hears "Dark mode, toggle button, pressed"),
    // never a name that swaps with the state as well, which reads as its own contradiction.
    <button type="button" onClick={toggleTheme} aria-pressed={isDark} aria-label="Dark mode"
            className={"rounded-lg border border-border px-3 py-1.5 text-300 text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 " + (className ?? "")}>
      Dark mode
    </button>
  );
}
