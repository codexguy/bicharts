import { describe, it, expect } from "vitest";
import {
    SEV_INFO, SEV_WARNING, SEV_ERROR, SEV_USER_PRESENTED, CLIENT_EVENT_KINDS, isEventLogCode, eventLogLine,
    type ClientMessage,
} from "../src/index";

describe("the client telemetry vocabulary", () => {
    it("the severity levels and the user-presented bit, as the service reads them", () => {
        expect([SEV_INFO, SEV_WARNING, SEV_ERROR, SEV_USER_PRESENTED]).toEqual([2, 3, 4, 0x40]);
        // A render failure the reader saw: the number a host has been sending as a literal.
        expect(SEV_ERROR | SEV_USER_PRESENTED).toBe(68);
        expect(SEV_WARNING | SEV_USER_PRESENTED).toBe(67);
    });

    it("the event kinds", () => {
        expect({ ...CLIENT_EVENT_KINDS }).toEqual({
            RENDER_START: "render-start", RENDER_OK: "render-ok", RENDER_ERROR: "render-error", VIEW: "view", VIEW_VERDICT: "view-verdict",
        });
        expect(Object.isFrozen(CLIENT_EVENT_KINDS)).toBe(true);
    });

    it("a client message is typed by the service's field names", () => {
        const m: ClientMessage = { OutputHash: "h", EventKind: CLIENT_EVENT_KINDS.RENDER_OK, Severity: SEV_INFO, ClientVersion: "1.0" };
        expect(Object.keys(m)).toEqual(["OutputHash", "EventKind", "Severity", "ClientVersion"]);
    });
});

describe("the event-count line", () => {
    it("a plain counter: code, version and client id", () => {
        expect(eventLogLine("see_whats_sent_xls", "1.0.0.64", "cid-1")).toBe("see_whats_sent_xls,1.0.0.64|cid-1");
    });

    it("with a magnitude: the count rounded and floored at 0, then the nonce", () => {
        expect(eventLogLine("llm_touch", "2.0.8.0", "cid", { count: 12, nonce: "n1" })).toBe("llm_touch,2.0.8.0|cid|12|n1");
        expect(eventLogLine("e", "v", "c", { count: 3.7, nonce: "x" })).toBe("e,v|c|4|x");
        expect(eventLogLine("e", "v", "c", { count: -5, nonce: "x" })).toBe("e,v|c|0|x");
    });

    it("a code that carries a delimiter, or none at all, cannot name a counter", () => {
        expect(isEventLogCode("mode_licensed")).toBe(true);
        for (const bad of ["", "a|b", "a,b"]) expect(isEventLogCode(bad), JSON.stringify(bad)).toBe(false);
    });
});
