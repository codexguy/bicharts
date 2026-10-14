// WHICH MEMORY A ZOOM HOOK WAS BUILT OVER. Package-internal: no entry exports it.
//
// A hook is a thin binding; everything it remembers lives on the ZoomMemoryHost it was built over. Two hooks over the
// same host are therefore the same memory, which a binding can ask here instead of comparing the hooks by identity.
// Kept in its own small module, outside the zoom-memory entry's folder, so a binding can ask without pulling the zoom
// code into its own bundle.
//
// The host rides on the hook as a non-enumerable property under a registry symbol, not in a module-level map: a consumer
// that bundles the React entry and the zoom-memory entry separately, without code splitting, gets two copies of this
// module, and a map in one copy would never hold what the other put in. Symbol.for names the same symbol in both.

const HOST_OF_HOOK = Symbol.for("@bicharts/chart-host/zoomMemoryHost");

/** Record the host a hook was built over (createZoomMemoryHook calls this). */
export function noteZoomMemoryHost(hook: object, host: object): void {
    try { Object.defineProperty(hook, HOST_OF_HOOK, { value: host, configurable: true }); } catch { /* a frozen hook is compared by identity */ }
}

/** The host a hook was built over, or undefined for a hook built some other way (compared by identity then). */
export function zoomMemoryHostOf(hook: unknown): object | undefined {
    return hook && typeof hook === "object" ? (hook as any)[HOST_OF_HOOK] : undefined;
}

/** Whether two hooks are the same memory: the same object, or built over the same host. */
export function sameZoomMemory(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    const ha = zoomMemoryHostOf(a);
    return ha !== undefined && ha === zoomMemoryHostOf(b);
}
