// The one language list, the one reading of a culture tag, and the check that every other list in
// this package agrees with the first.
import { describe, it, expect } from "vitest";
import {
    SUPPORTED_LANGUAGES, SUPPORTED_LANGUAGE_CODES, resolveLanguage, supportedLanguage,
    type SupportedLanguageCode,
} from "../src/languages";
import { SUPPORTED_LANGS, countryIso3 } from "../src/geoCountryNames";
import {
    INTENSIVE_WORD_TOKENS, LOCALIZED_DEFAULT_AGG_PREFIXES, LOCALIZED_CHOICE_AGG_PREFIXES,
} from "../src/aggregation";

describe("the Tier 1 list", () => {
    it("is exactly the thirty decided languages, once each, English first", () => {
        expect([...SUPPORTED_LANGUAGE_CODES].sort()).toEqual([
            "ar", "cs", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "hr", "hu", "id", "it",
            "ja", "ko", "nb", "nl", "pl", "pt", "ro", "ru", "sk", "sv", "th", "tr", "uk", "vi", "zh",
        ]);
        expect(new Set(SUPPORTED_LANGUAGE_CODES).size).toBe(30);
        expect(SUPPORTED_LANGUAGE_CODES[0]).toBe("en");
    });

    it("gives each language the properties its script costs", () => {
        const by = (c: string) => SUPPORTED_LANGUAGES.find(l => l.code === c)!;
        expect(["ar", "he"].map(c => by(c).dir)).toEqual(["rtl", "rtl"]);
        expect(SUPPORTED_LANGUAGES.filter(l => l.dir === "rtl").map(l => l.code).sort()).toEqual(["ar", "he"]);
        expect(SUPPORTED_LANGUAGES.filter(l => !l.wordBreaks).map(l => l.code).sort()).toEqual(["ja", "th", "zh"]);
        expect(SUPPORTED_LANGUAGES.filter(l => l.compounds).map(l => l.code).sort())
            .toEqual(["da", "de", "fi", "hu", "nb", "nl", "sv"]);
        expect(SUPPORTED_LANGUAGES.filter(l => l.gluedPrefixes.length).map(l => l.code).sort()).toEqual(["ar", "he"]);
        expect(SUPPORTED_LANGUAGES.filter(l => l.foldSensitive).map(l => l.code)).toEqual(["vi"]);
        expect(by("hi").script).toBe("Deva");
        expect(by("ja").script).toBe("Jpan");
    });

    it("every Intl tag is one the runtime can format with", () => {
        for (const l of SUPPORTED_LANGUAGES) {
            expect(Intl.NumberFormat.supportedLocalesOf([l.intl]), l.code).toEqual([l.intl]);
        }
    });

    it("no alias is itself a Tier 1 code, and no alias is claimed twice", () => {
        const aliases = SUPPORTED_LANGUAGES.flatMap(l => l.aliases);
        expect(new Set(aliases).size).toBe(aliases.length);
        for (const a of aliases) expect(SUPPORTED_LANGUAGE_CODES as readonly string[]).not.toContain(a);
    });
});

describe("resolveLanguage - the one reading of a host's culture", () => {
    const cases: Array<[string | null | undefined, SupportedLanguageCode, 1 | 2, string]> = [
        ["en-US", "en", 1, "en-US"],
        ["en", "en", 1, "en"],
        ["EN_gb", "en", 1, "en-GB"],
        ["es-ES", "es", 1, "es-ES"],
        ["pt-BR", "pt", 1, "pt-BR"],
        ["pt-PT", "pt", 1, "pt-PT"],
        // Norwegian: hosts send both, and the table must never be keyed by one no host resolves to.
        ["nb-NO", "nb", 1, "nb-NO"],
        ["no", "nb", 1, "no"],
        ["no-NO", "nb", 1, "no-NO"],
        // Chinese: Simplified is Tier 1, Traditional is Tier 2 (text from zh, formatting as asked).
        ["zh-CN", "zh", 1, "zh-CN"],
        ["zh-SG", "zh", 1, "zh-SG"],
        ["zh-Hans", "zh", 1, "zh-Hans"],
        ["zh", "zh", 1, "zh"],
        ["zh-TW", "zh", 2, "zh-TW"],
        ["zh-HK", "zh", 2, "zh-HK"],
        ["zh-Hant", "zh", 2, "zh-Hant"],
        ["zh-Hant-TW", "zh", 2, "zh-Hant-TW"],
        // The pre-1989 codes some runtimes still emit.
        ["iw-IL", "he", 1, "he-IL"],
        ["in-ID", "id", 1, "id-ID"],
        ["ar-SA", "ar", 1, "ar-SA"],
        ["hi-IN", "hi", 1, "hi-IN"],
        ["th-TH", "th", 1, "th-TH"],
        // Outside Tier 1: English text, the runtime's formatting when it has it.
        ["sw-KE", "en", 2, "sw-KE"],
        ["nn-NO", "nb", 2, "nn-NO"],
        // Nothing sent, or nothing readable: English, Tier 1.
        ["", "en", 1, "en"],
        [null, "en", 1, "en"],
        [undefined, "en", 1, "en"],
        ["not a tag!", "en", 1, "en"],
    ];
    it.each(cases)("%s -> %s (tier %s, intl %s)", (tag, code, tier, intl) => {
        const r = resolveLanguage(tag);
        expect(r.code).toBe(code);
        expect(r.tier).toBe(tier);
        expect(r.intl).toBe(intl);
        expect(r.language.code).toBe(code);
    });

    it("finds a language by code or alias, and nothing else", () => {
        expect(supportedLanguage("no")?.code).toBe("nb");
        expect(supportedLanguage("NB")?.code).toBe("nb");
        expect(supportedLanguage("xx")).toBeUndefined();
    });
});

// ── THE LIST-CONSISTENCY CHECK ─────────────────────────────────────────────────────────────────
// Every language-bearing list in this package, against the Tier 1 list. A list keyed by language
// is compared directly; a flat vocabulary (the intensive tokens, the aggregation prefixes) carries
// its language claim HERE, token by token, and a token added without a claim fails the union check.

describe("the country-name languages ARE the Tier 1 list", () => {
    it("same set, English first", () => {
        expect([...SUPPORTED_LANGS].sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
        expect(SUPPORTED_LANGS[0]).toBe("en");
    });

    it("recognizes a country written in the three languages the old list lacked", () => {
        expect(countryIso3("Nemecko")).toBe("DEU");        // sk
        expect(countryIso3("Németország")).toBe("DEU");    // hu
        expect(countryIso3("Njemačka")).toBe("DEU");       // hr
        expect(countryIso3("Tyskland")).toBe("DEU");       // nb (also sv, da)
    });
});

/** Which language(s) each LOCALIZED intensive token belongs to. */
const INTENSIVE_TOKEN_LANGUAGES: Record<string, SupportedLanguageCode[]> = {
    temperatuur: ["nl"], temperatur: ["de", "sv", "da", "nb"], temperatura: ["es", "pt", "it", "pl", "ro", "hr"],
    teplota: ["cs", "sk"], lampotila: ["fi"], homerseklet: ["hu"], sicaklik: ["tr"],
    pression: ["fr"], presion: ["es"], pressao: ["pt"], pressione: ["it"], druck: ["de"], tryck: ["sv"],
    tlak: ["cs", "sk", "hr"], paine: ["fi"], nyomas: ["hu"], presiune: ["ro"],
    humidite: ["fr"], humedad: ["es"], umidade: ["pt"], umidita: ["it"], feuchtigkeit: ["de"],
    vochtigheid: ["nl"], kosteus: ["fi"], vlhkost: ["cs", "sk"],
    vitesse: ["fr"], velocidad: ["es"], velocidade: ["pt"], velocita: ["it"], geschwindigkeit: ["de"],
    snelheid: ["nl"], hastighet: ["sv", "nb"], hastighed: ["da"], rychlost: ["cs", "sk"], nopeus: ["fi"],
    sebesseg: ["hu"], brzina: ["hr"], predkosc: ["pl"],
    densite: ["fr"], densidad: ["es"], densidade: ["pt"], densita: ["it"], dichte: ["de"],
    dichtheid: ["nl"], hustota: ["cs", "sk"], tiheys: ["fi"], gustoca: ["hr"],
    moyenne: ["fr"], mediane: ["fr"], promedio: ["es"], mediana: ["es", "pt", "it", "pl", "hr", "ro"],
    gemiddelde: ["nl"], durchschnitt: ["de"], mittelwert: ["de"], genomsnitt: ["sv"], gennemsnit: ["da"],
    gjennomsnitt: ["nb"], keskiarvo: ["fi"], atlag: ["hu"], ortalama: ["tr"], prosjek: ["hr"],
    srednia: ["pl"], prumer: ["cs"], priemer: ["sk"], medie: ["ro"],
    taux: ["fr"], tasa: ["es"], taxa: ["pt"], tasso: ["it"], verhaltnis: ["de"], verhouding: ["nl"],
    aandeel: ["nl"], anteil: ["de"], andel: ["sv", "da", "nb"], osuus: ["fi"], podil: ["cs"],
    udzial: ["pl"], udio: ["hr"], pourcentage: ["fr"], porcentaje: ["es"], percentual: ["pt"],
    prozent: ["de"], procent: ["nl", "sv", "da", "pl", "ro"], prosentti: ["fi"], szazalek: ["hu"],
    yuzde: ["tr"], participacion: ["es"], participacao: ["pt"], pondere: ["fr"], omjer: ["hr"],
    arany: ["hu"], oran: ["tr"], rata: ["ro"],
    leeftijd: ["nl"], edad: ["es"], idade: ["pt"], wiek: ["pl"], eletkor: ["hu"], varsta: ["ro"],
    puntuacion: ["es"], pontuacao: ["pt"], punteggio: ["it"], betyg: ["sv"], ocena: ["pl"],
    indice: ["fr", "es", "it", "pt"], indeks: ["pl", "hr", "da", "nb"], wskaznik: ["pl"], puan: ["tr"],
};

/** Which language(s) each localized host-aggregation prefix belongs to. */
const AGG_PREFIX_LANGUAGES: Record<string, SupportedLanguageCode[]> = {
    "somme de": ["fr"], "suma de": ["es"], "soma de": ["pt"], "summe von": ["de"], "som van": ["nl"],
    "somma di": ["it"], "summa av": ["sv"], "sum av": ["nb"], "sum af": ["da"], "soucet z": ["cs"],
    "suma z": ["pl", "sk"], "totaal van": ["nl"], "total de": ["es", "pt", "fr"], "toplam": ["tr"],
    "osszeg": ["hu"], "nombre de": ["fr"], "recuento de": ["es"], "contagem de": ["pt"],
    "anzahl von": ["de"], "aantal van": ["nl"], "conteggio di": ["it"], "antal av": ["sv"],
    "lukumaara": ["fi"], "pocet z": ["cs", "sk"],
    "moyenne de": ["fr"], "promedio de": ["es"], "media de": ["es", "pt"], "media di": ["it"],
    "durchschnitt von": ["de"], "gemiddelde van": ["nl"], "medelvarde av": ["sv"], "genomsnitt av": ["sv"],
    "gennemsnit af": ["da"], "keskiarvo": ["fi"], "atlag": ["hu"], "ortalama": ["tr"], "prumer z": ["cs"],
    "srednia z": ["pl"], "medie de": ["ro"], "minimum de": ["fr"], "minimo de": ["es", "pt"],
    "minimo di": ["it"], "minimum von": ["de"], "maximum de": ["fr"], "maximo de": ["es", "pt"],
    "massimo di": ["it"], "maximum von": ["de"],
};

/** What those vocabularies cover TODAY, and - by subtraction - what they owe. Changing either
 *  side of this is a deliberate act: adding a language to a vocabulary means updating its claim
 *  here, and the replay that vetted it goes with it. Everything non-Latin is owed, because the
 *  server copy of these lists is ASCII-only by construction until its reader reads Unicode. */
const INTENSIVE_COVERS: SupportedLanguageCode[] =
    ["en", "nl", "de", "fr", "es", "pt", "it", "pl", "cs", "sk", "sv", "da", "nb", "fi", "hu", "tr", "ro", "hr"];
const AGG_PREFIX_COVERS: SupportedLanguageCode[] =
    ["en", "nl", "de", "fr", "es", "pt", "it", "pl", "cs", "sk", "sv", "da", "nb", "fi", "hu", "tr", "ro"];

/** The localized slice of the intensive list - everything after the marker comment in the array. */
const ENGLISH_INTENSIVE = new Set([
    "rate", "ratio", "pct", "percent", "percentage", "rating", "share", "score", "index", "nps", "csat",
    "margin", "yield", "coverage", "utilization", "utilisation", "z[_-]?score", "average", "avg", "mean",
    "median", "stddev", "variance", "gpa", "percentile", "quantile", "efficiency", "accuracy",
    "probability", "multiplier", "coefficient", "correlation", "occupancy", "age", "bmi", "temperature",
    "density", "pressure", "humidity", "ph", "velocity", "speed", "elevation", "altitude", "latency",
    "throughput", "bandwidth", "iops", "ppm", "ppb", "dpmo", "bps",
]);

describe("every flat vocabulary's language claim agrees with the Tier 1 list", () => {
    it("every localized intensive token carries a claim, and only those tokens do", () => {
        const localized = INTENSIVE_WORD_TOKENS.filter(t => !ENGLISH_INTENSIVE.has(t));
        expect(Object.keys(INTENSIVE_TOKEN_LANGUAGES).sort()).toEqual([...localized].sort());
    });

    it("every localized aggregation prefix carries a claim, and only those do", () => {
        expect(Object.keys(AGG_PREFIX_LANGUAGES).sort())
            .toEqual([...LOCALIZED_DEFAULT_AGG_PREFIXES, ...LOCALIZED_CHOICE_AGG_PREFIXES].sort());
    });

    it("every claimed language is a Tier 1 language", () => {
        for (const langs of [...Object.values(INTENSIVE_TOKEN_LANGUAGES), ...Object.values(AGG_PREFIX_LANGUAGES)]) {
            for (const l of langs) expect(SUPPORTED_LANGUAGE_CODES, l).toContain(l);
        }
    });

    it("the coverage each vocabulary claims is exactly the coverage its tokens give", () => {
        const intensive = new Set<string>(["en", ...Object.values(INTENSIVE_TOKEN_LANGUAGES).flat()]);
        expect([...intensive].sort()).toEqual([...INTENSIVE_COVERS].sort());
        const prefixes = new Set<string>(["en", ...Object.values(AGG_PREFIX_LANGUAGES).flat()]);
        expect([...prefixes].sort()).toEqual([...AGG_PREFIX_COVERS].sort());
    });

    it("what they owe is recorded, not silent: the rest of the thirty", () => {
        const owed = (covers: string[]) => SUPPORTED_LANGUAGE_CODES.filter(c => !covers.includes(c));
        expect(owed(INTENSIVE_COVERS)).toEqual(["id", "vi", "ru", "uk", "el", "zh", "ja", "ko", "ar", "he", "hi", "th"]);
        expect(owed(AGG_PREFIX_COVERS)).toEqual(["hr", "id", "vi", "ru", "uk", "el", "zh", "ja", "ko", "ar", "he", "hi", "th"]);
    });
});
