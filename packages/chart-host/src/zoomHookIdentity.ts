// WHICH MEMORY A ZOOM HOOK WAS BUILT OVER. Package-internal: no entry exports it.
//
// A hook is a thin binding; everything it remembers lives on the ZoomMemoryHost it was built over. Two hooks over the
// same host are therefore the same memory, and a binding that compares hooks by identity (React's effect deps) would
// rebuild its chart host for a page that writes createZoomMemoryHook(h) inline in its props, once per parent render.
// Kept in its own small module, outside the zoom-memory entry's folder, so the React binding can ask without pulling
// the zoom code into its own bundle.

const hostOfHook = new WeakMap<object, object>();

/** Record the host a hook was built over (createZoomMemoryHook calls this). */
export function noteZoomMemoryHost(hook: object, host: object): void {
    hostOfHook.set(hook, host);
}

/** The host a hook was built over, or undefined for a hook built some other way (compared by identity then). */
export function zoomMemoryHostOf(hook: unknown): object | undefined {
    return hook && typeof hook === "object" ? hostOfHook.get(hook) : undefined;
}

/** Whether two hooks are the same memory: the same object, or built over the same host. */
export function sameZoomMemory(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    const ha = zoomMemoryHostOf(a);
    return ha !== undefined && ha === zoomMemoryHostOf(b);
}
