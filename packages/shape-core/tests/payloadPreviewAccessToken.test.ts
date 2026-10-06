// A signed-in account's access token is a bearer credential, so a "what is sent" panel never shows it.
import { describe, it, expect } from "vitest";
import { payloadPreview, PREVIEW_OMITTED_FIELDS } from "../src/payloadPreview";

describe("payloadPreview - the access token is a credential", () => {
    it("is omitted by name, beside the triple and the link nonce", () => {
        expect(PREVIEW_OMITTED_FIELDS).toContain("accessToken");
        const shown = payloadPreview({ licenseKey: "", accessToken: "bat_secret", totalRows: 3 });
        expect(Object.keys(shown)).toEqual(["totalRows"]);
        expect(JSON.stringify(shown)).not.toContain("bat_secret");
    });
});
