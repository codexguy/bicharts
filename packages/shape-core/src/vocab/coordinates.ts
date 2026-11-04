// COORDINATE WORDS - other languages' words for LATITUDE and LONGITUDE (a Spanish table's `latitud (º)` /
// `longitud (º)` were never read, so no map was offered). English (`lat`, `latitude`, `lon`, `lng`, `long`, `longitude`) is the
// callers' own test and is read first.
//
// A WORD HERE ONLY NOMINATES A COLUMN. `longitud` means LENGTH as often as longitude; a column is a coordinate only as half of a
// PAIR whose measured values fit (latitude within +-90, longitude within +-180). Every caller applies that check; nothing may
// read these words alone.
//
// WHOLE WORDS ONLY - no compound suffix view: `Gesamtlänge` (total length) and `Kabellänge` must not nominate anything.
// The bare German `Breite` / `Länge` (width / length in every product-dimension table) are left out on purpose: only the
// `-grad` forms are listed, and the Dutch `-graad` forms are compound-only to begin with.
// Matched folded and case-free (see coordinateAxisOfWords).
//
// The server's copy is GENERATED from the parity block; edit here, then regenerate.

import { foldName } from "../nameReader";
import type { VocabularyLanguageCode } from "../languages";

type Vocab = Partial<Record<VocabularyLanguageCode, readonly string[]>>;

/* parity:coordinate-words:begin */
export const LATITUDE_WORDS: Vocab = {
    es: ["latitud"], pt: ["latitude"], fr: ["latitude"], it: ["latitudine"], nl: ["breedtegraad"], de: ["breitengrad"],
};
export const LONGITUDE_WORDS: Vocab = {
    es: ["longitud"], pt: ["longitude"], fr: ["longitude"], it: ["longitudine"], nl: ["lengtegraad"], de: ["längengrad"],
};
/* parity:coordinate-words:end */

const key = (w: string) => foldName(w.normalize("NFC")).toLowerCase();
const LAT = new Set(Object.values(LATITUDE_WORDS).flatMap(ws => (ws ?? []).map(key)));
const LON = new Set(Object.values(LONGITUDE_WORDS).flatMap(ws => (ws ?? []).map(key)));

/** "lat" / "lon" when one of a name's words (as nameLetterRuns gives them) is another language's latitude / longitude word,
 *  else null (also null when the name carries both). A nomination, never an admission - see the header. */
export function coordinateAxisOfWords(words: readonly string[]): "lat" | "lon" | null {
    let lat = false, lon = false;
    for (const w of words) { const k = key(w); if (LAT.has(k)) lat = true; else if (LON.has(k)) lon = true; }
    return lat === lon ? null : (lat ? "lat" : "lon");
}
