// THE REQUEST WIRE (2026-09-24): the envelope every signed request travels in, the signature
// over it, and the one rule for reading a response field in either casing.
//
// A CONTRACT with the server, not a design: the server undoes exactly these steps, so nothing
// here is a local choice. Each host wrote its own copy of all three; they agreed by testing
// against the same known answers, and now they agree by being one function.
//
// The envelope: JSON -> gzip -> base64 -> every '/' written as '.'. The server reverses the
// substitution unconditionally before base64-decoding, so an unsubstituted body fails to
// inflate. The signature: a keyed hash over the ENCODED body, sent as a header. The key stays
// in the host, which passes a WireSigner; the algorithm lives here.
//
// ONE COMPRESSOR FOR EVERY HOST (2026-09-24). Two gzip implementations at the same level emit
// different - equally valid - byte streams for the same text, and until this date each host
// compressed with its own (two pako majors and Node's zlib), so the same request left three
// hosts as three byte streams. The server inflates any valid gzip, so nothing failed; but a
// request could not be compared across hosts byte for byte, and a known answer held for one
// host only. The envelope now compresses with ONE pako, pinned to an exact version in this
// package's manifest (no range), so the bytes of a request are a property of the request.

import { gzip } from "pako";
import type { WireSigner } from "./host/services";
import { SIMPLE_STRING_HASH } from "./util";

/** Gzip one string (the request's JSON) to bytes. */
export type GzipText = (text: string) => Uint8Array;

/**
 * The envelope's compressor: pako's gzip at its default level (6), from the exact pako version
 * this package pins. Exported so a host's test can derive a known answer from the same
 * function the envelope uses; a host never needs to call it.
 */
export const gzipWireText: GzipText = text => gzip(text);

/**
 * JSON -> gzip -> base64 -> '/' to '.'. The body every signed request sends, compressed with
 * `gzipWireText`.
 */
export function encodePayload(payload: unknown): string;
/**
 * @deprecated The compressor is no longer the host's: every envelope is compressed with this
 * package's pinned pako (`gzipWireText`), and a second argument is IGNORED. The overload is
 * kept only so a caller written against 0.6.1-0.6.3 still compiles; drop the argument.
 */
export function encodePayload(payload: unknown, gzip: GzipText): string;
export function encodePayload(payload: unknown): string {
    return base64FromBytes(gzipWireText(JSON.stringify(payload))).replace(/\//g, ".");
}

/**
 * Bytes -> base64 without the argument-count limit of `String.fromCharCode(...bytes)`, which
 * throws a RangeError on a realistic request (a wide shape payload gzips past 100k bytes).
 */
function base64FromBytes(bytes: Uint8Array): string {
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/**
 * The signer every host builds: the shared 53-bit FNV-1a hash over the encoded body with the
 * host's key appended, as a decimal string. The key is the host's to hold - each keeps it out
 * of plain text in its own way - and this package never sees it except as an argument.
 */
export function keyedSigner(key: string): WireSigner {
    if (typeof key !== "string" || key === "") {
        throw new TypeError("keyedSigner needs the host's signing key");
    }
    return { sign: (encodedBody: string) => String(SIMPLE_STRING_HASH(encodedBody + key)) };
}

/**
 * The signature header value for an already-encoded body. Throws when the signer returns
 * anything but a non-blank string: a well-formed-looking signature that every request fails
 * on reads as a network fault, which is far harder to diagnose than this throw.
 */
export function messageSignature(encodedBody: string, signer: WireSigner): string {
    const sig = signer.sign(encodedBody);
    if (typeof sig !== "string" || sig.trim() === "") {
        throw new TypeError("the host's signer returned a blank signature");
    }
    return sig;
}

/**
 * A response field read in either casing. The server may serialise camelCase or PascalCase,
 * so `readWireField(data, "errorMessage")` returns `data.errorMessage` and falls back to
 * `data.ErrorMessage` when the camel form is absent or null. A null or non-object `data`
 * reads as absent.
 */
export function readWireField(data: unknown, camelName: string): any {
    if (data === null || data === undefined || typeof data !== "object") return undefined;
    const rec = data as Record<string, unknown>;
    const v = rec[camelName];
    if (v !== undefined && v !== null) return v;
    return rec[camelName.charAt(0).toUpperCase() + camelName.slice(1)];
}
