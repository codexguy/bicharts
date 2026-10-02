/*
    ONE PAGE, MANY CHARTS, ONE ID SPACE.

    A chart names its clip paths, gradients and masks with ids, and refers to them as url(#id). Those ids are
    deterministic on purpose - the same chart at the same size draws the same document - so two charts of one size on
    one page can name a clip path identically. The browser resolves url(#id) to the FIRST element with that id in the
    document, so the second chart is clipped by the first chart's rectangle, silently: a world flow map beside a world
    choropleth of the same tile size lost the top of Canada to the choropleth's clip, with nothing in the console.

    This pass runs after every render. Each id the chart REFERENCES - by url(#id) in any attribute or inline style, or
    by href / xlink:href "#id" - gets a per-host suffix, and every such reference inside the chart (and the id lists of
    aria-labelledby, aria-describedby and for) follows it. Ids nothing references that way keep their names, so code
    that finds an element by id still does; ids the host itself owns ("bic-" prefixed) are left alone. It reports each
    scoped id that another chart on the page also named - the collision that would have happened.

    Nothing here throws: it runs after a render that already succeeded.
*/

let seq = 0;

/** A fresh suffix for one chart host. Unique within the page for the page's lifetime. */
export function newIdScope(): string {
    seq += 1;
    return "h" + seq;
}

export interface IdScopeReport {
    /** How many ids were given the suffix. */
    renamed: number;
    /** Ids that also existed outside this chart when the pass ran - each one a clash this pass prevented. */
    collisions: string[];
}

const URL_REF = /url\(\s*(['"]?)#([^'")\s]+)\1\s*\)/g;
const ID_LIST_ATTRS = ["aria-labelledby", "aria-describedby", "for"];

export function scopeChartIds(container: Element, scope: string): IdScopeReport {
    const report: IdScopeReport = { renamed: 0, collisions: [] };
    try {
        if (!container || typeof container.querySelectorAll !== "function") return report;
        const tag = "--" + scope;
        const doc = container.ownerDocument;
        const map = new Map<string, string>();
        // ONLY THE IDS THE CHART REFERENCES BY URL OR HREF - its clip paths, gradients, masks, markers and patterns,
        // which the browser resolves page-wide. Every other id keeps its name, so code that finds an element by id
        // (a tooltip, a tick a test clicks) still finds it.
        const referenced = new Set<string>();
        container.querySelectorAll("*").forEach(el => {
            const names = typeof el.getAttributeNames === "function" ? el.getAttributeNames() : [];
            for (const a of names) {
                const v = el.getAttribute(a);
                if (!v || v.indexOf("#") < 0) continue;
                if (v.indexOf("url(") >= 0) for (const m of v.matchAll(URL_REF)) referenced.add(m[2]);
                if ((a === "href" || a === "xlink:href") && v.charAt(0) === "#") referenced.add(v.slice(1));
            }
        });
        if (!referenced.size) return report;
        container.querySelectorAll("[id]").forEach(el => {
            const id = el.getAttribute("id");
            if (!id || !referenced.has(id) || id.endsWith(tag) || id.startsWith("bic-")) return;
            if (doc) {
                let elsewhere = false;
                try {
                    // The same id, or the same id already scoped to another host: either way two charts named it.
                    const q = id.replace(/["\\]/g, "\\$&");
                    const all = doc.querySelectorAll(`[id="${q}"], [id^="${q}--h"]`);
                    for (let i = 0; i < all.length && !elsewhere; i++) if (!container.contains(all[i])) elsewhere = true;
                } catch { /* an id no selector can name is still renamed */ }
                if (elsewhere && !report.collisions.includes(id)) report.collisions.push(id);
            }
            const next = id + tag;
            map.set(id, next);
            el.setAttribute("id", next);
            report.renamed++;
        });
        if (!map.size) return report;
        container.querySelectorAll("*").forEach(el => {
            const names = typeof el.getAttributeNames === "function" ? el.getAttributeNames() : [];
            for (const a of names) {
                const v = el.getAttribute(a);
                if (!v) continue;
                let nv = v;
                if (v.indexOf("url(") >= 0) {
                    nv = nv.replace(URL_REF, (m, q, id) => (map.has(id) ? `url(${q}#${map.get(id)}${q})` : m));
                }
                if ((a === "href" || a === "xlink:href") && nv.charAt(0) === "#" && map.has(nv.slice(1))) {
                    nv = "#" + map.get(nv.slice(1));
                }
                if (ID_LIST_ATTRS.includes(a)) {
                    nv = nv.split(/\s+/).map(t => map.get(t) ?? t).join(" ");
                }
                if (nv !== v) el.setAttribute(a, nv);
            }
        });
    } catch { /* a scoping pass must never break a render that already succeeded */ }
    return report;
}
