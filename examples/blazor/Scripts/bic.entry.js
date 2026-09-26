import * as d3base from "d3";
import { assembleD3, createChartGroup, createChartHost, loadGeo } from "@bicharts/chart-host";

const d3 = assembleD3(d3base);                           // + any plugins a chart's contract names
const at = (path) => new URL(path, document.baseURI);   // honours <base href> on a sub-path host
async function text(path) {
    const r = await fetch(at(path));
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.text();
}
// Draw for the canvas the chart actually sits on - the nearest opaque background behind it. A page
// that follows the reader's light/dark preference switches that background; a light-only page keeps
// it light, and the chart's text stays dark there even when the reader's system is dark.
function canvasOf(el) {
    for (let e = el; e; e = e.parentElement) {
        const m = getComputedStyle(e).backgroundColor.match(/[0-9.]+/g);
        if (m && (m.length < 4 || +m[3] > 0.5)) return m.slice(0, 3).map(Number);
    }
    return [255, 255, 255];
}
const theme = (el) => {
    const [r, g, b] = canvasOf(el);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
        ? { themeFg: "#f3f4f6", themeBg: `rgb(${r}, ${g}, ${b})`, themeAccent: "#118dff" }
        : { themeFg: "#252423", themeAccent: "#118dff" };
};

// ONE group over ONE source table: a data.sample.json's positional rows, as objects.
export async function createGroup(sampleUrl, dotnet) {
    const sample = JSON.parse(await text(sampleUrl));
    const cols = sample.columns;
    const rows = sample.rows.map(r => Object.fromEntries(cols.map((c, i) => [c.name, r[i]])));
    const group = createChartGroup(cols, rows);
    const off = group.onChange(sel => dotnet.invokeMethodAsync("OnSelectionChanged", sel.sourceId, [...sel.rows]));
    return {
        async mount(el, spec) {                          // spec: { id, dir, height, respondsWith, geoKind }
            const code = await text(`${spec.dir}/chart.js`);   // TEXT: chart-host compiles it and injects d3
            if (spec.geoKind) await loadGeo(spec.geoKind);     // BEFORE the first render: render() is synchronous
            const opts = spec.respondsWith ? { respondsWith: spec.respondsWith } : {};
            const host = createChartHost(el, {
                code, d3, geoKind: spec.geoKind || undefined,
                data: group.memberPayload(spec.id, opts).payload,
                options: { width: Math.floor(el.getBoundingClientRect().width), height: spec.height, ...theme(el) },
            });
            host.render();
            const member = group.attach(spec.id, host, opts);  // its clicks publish SOURCE rows
            let w = Math.floor(el.getBoundingClientRect().width);
            const ro = new ResizeObserver(() => {         // LATER resizes only; the first size is measured above
                const now = Math.floor(el.getBoundingClientRect().width);
                if (now > 0 && now !== w) { w = now; host.setOptions({ width: now }); }
            });
            ro.observe(el);
            const mq = matchMedia("(prefers-color-scheme: dark)");
            const onScheme = () => host.setOptions(theme(el));   // the page restyled itself; follow it
            mq.addEventListener("change", onScheme);
            let alive = true;
            return {
                setOptions(patch) { if (alive) host.setOptions(patch); },   // live restyle, never a regeneration
                destroy() {
                    if (!alive) return;
                    alive = false;
                    ro.disconnect();
                    mq.removeEventListener("change", onScheme);
                    member.detach();
                    host.destroy();                       // stops animation timers too
                },
            };
        },
        clear() { group.clear(); },
        dispose() { off(); group.destroy(); },
    };
}
