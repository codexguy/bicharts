// THE HOST SERVICES A CHART MAY CALL (contract 1.18.0), built the same way in every host.
//
// A chart cannot navigate or reach the clipboard on its own in a sandboxed host, so it draws a link only where
// options.openUrl exists and copies through options.copyText where it exists. Each host has its own way to open an
// address (a Power BI visual's launchUrl, an Office add-in's openBrowserWindow, a page's window.open) and its own
// clipboard, and hands them here; this builds the two services with one set of rules:
//   - openUrl passes only http(s) and mailto addresses to the host's opener, trimmed. A chart already refuses any
//     other scheme; this is the second wall, so a chart that slipped could still not open javascript: or data:.
//   - copyText answers FALSE when the write fails or the clipboard has no writeText, so a chart opens its own copy sheet
//     instead of claiming a copy that did not happen. A host that passes NO clipboard gets no copyText at all, and a
//     chart then uses the browser's own copy command inside the reader's keypress - the right choice where the async
//     clipboard needs a permission the host's frame may not grant (a sandboxed visual).
// Neither ever logs the address or the text.

/** The clipboard half a host can supply: navigator.clipboard, or anything with the same writeText. */
export interface ClipboardLike {
    writeText?: (text: string) => Promise<void>;
}

/** The two services, ready to spread into a host's render options: each is absent when the host supplied nothing for it. */
export interface HostLinkServices {
    openUrl?: (url: string) => void;
    copyText?: (text: string) => boolean | Promise<boolean>;
}

const LINK_SCHEME_RE = /^(https?:\/\/|mailto:)/i;

/** Builds openUrl and copyText from a host's own opener and clipboard. */
export function hostLinkServices(open: ((url: string) => void) | undefined | null, clipboard: ClipboardLike | undefined | null): HostLinkServices {
    const out: HostLinkServices = {};
    if (clipboard) {
        out.copyText = (text: string): boolean | Promise<boolean> => {
            try {
                if (typeof clipboard.writeText !== "function") return false;
                return clipboard.writeText(String(text ?? "")).then(() => true, () => false);
            } catch {
                return false;
            }
        };
    }
    if (typeof open === "function") {
        out.openUrl = (url: string) => {
            const u = String(url ?? "").trim();
            if (LINK_SCHEME_RE.test(u)) open(u);
        };
    }
    return out;
}
