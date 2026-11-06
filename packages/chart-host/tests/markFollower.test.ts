import { describe, it, expect, beforeEach } from "vitest";
import { JSDOM } from "jsdom";
import { followMarks } from "../src/markFollower";
import { MARK_CLASS } from "../src/contract";

// FOLLOWING MARKS THAT MOVE WITHOUT A RENDER: the mechanism a host uses to keep what it paints over the marks on them.
// A write that moves a mark, or the element holding it, repaints once on the next frame; a write on anything else, or
// inside the host's own layers, repaints nothing; nothing is followed once following stops.

const NS = "http://www.w3.org/2000/svg";
let dom: JSDOM;
let container: HTMLElement;
let zoom: Element, mark: Element, tip: HTMLElement, layer: HTMLElement;

beforeEach(() => {
    dom = new JSDOM("<!doctype html><html><body><div id='c'></div></body></html>");
    const doc = dom.window.document;
    container = doc.getElementById("c") as unknown as HTMLElement;
    const svg = doc.createElementNS(NS, "svg");
    zoom = doc.createElementNS(NS, "g");
    mark = doc.createElementNS(NS, "path");
    mark.setAttribute("class", MARK_CLASS);
    zoom.appendChild(mark);
    svg.appendChild(zoom);
    container.appendChild(svg);
    tip = doc.createElement("div");
    container.appendChild(tip);
    layer = doc.createElement("div");
    layer.className = "host-layer";
    layer.appendChild(doc.createElement("span"));
    container.appendChild(layer);
});

const frame = () => new Promise(r => setTimeout(r, 40));

describe("followMarks", () => {
    it("a zoom on the layer holding the marks repaints once on the next frame, however many writes land in it", async () => {
        const calls: boolean[] = [];
        const f = followMarks(container, { blind: ".host-layer", repaint: r => calls.push(r) });
        f.follow(true);
        expect(f.following).toBe(true);
        zoom.setAttribute("transform", "translate(10,0)");
        zoom.setAttribute("transform", "translate(20,0) scale(2)");
        mark.setAttribute("d", "M0,0h1v1Z");
        await frame();
        expect(calls).toEqual([false]);
    });

    it("a write that holds no mark, or one inside the host's own layer, repaints nothing", async () => {
        const calls: boolean[] = [];
        const f = followMarks(container, { blind: ".host-layer", repaint: r => calls.push(r) });
        f.follow(true);
        tip.setAttribute("style", "left: 4px");
        (layer.firstChild as HTMLElement).setAttribute("style", "left: 4px");
        await frame();
        expect(calls).toEqual([]);
    });

    it("stopped, it follows nothing; records taken after a paint are not a move", async () => {
        const calls: boolean[] = [];
        const f = followMarks(container, { repaint: r => calls.push(r) });
        f.follow(true);
        mark.setAttribute("class", `${MARK_CLASS} lit`);
        f.takeRecords();
        await frame();
        expect(calls).toEqual([]);
        f.follow(false);
        expect(f.following).toBe(false);
        zoom.setAttribute("transform", "translate(5,5)");
        await frame();
        expect(calls).toEqual([]);
    });

    it("a repaint that throws never escapes", async () => {
        const f = followMarks(container, { repaint: () => { throw new Error("painter down"); } });
        f.follow(true);
        zoom.setAttribute("transform", "translate(1,1)");
        await expect(frame()).resolves.toBeUndefined();
    });
});
