import { describe, it, expect } from "vitest";
import { HOST_TEXT_CATALOGS, chartHostStrings } from "../src/strings";
import { computeSelectionCard } from "../src/selectionCard";
import { POINT_ROLE_FACT_ENGLISH } from "../src/geoRoleText";

// THE PACKAGE'S OWN CATALOGS are the only check a translation gets before a reader sees it, so every rule is pass/fail:
// each language carries every key the card reads, with the English's placeholders, and a counted key carries exactly the
// plural categories Intl.PluralRules gives that language (Arabic six, Japanese one) - a missing form is a sentence that
// silently falls back to another form's grammar.

const ENGLISH: Record<string, string | Record<string, string>> = {
    "card.blank": "(blank)",
    "card.marks": { one: "{n} mark", other: "{n} marks" },
    "card.header.marks": { one: "{n} mark", other: "{n} marks" },
    "card.list.separator": ", ",
    "card.measure.sum": "Sum of {column}",
    "card.measure.average": "Average of {column}",
    "card.measure.min": "Min of {column}",
    "card.measure.max": "Max of {column}",
    "card.measure.count": "Count of {column}",
    "card.measure.median": "Median of {column}",
    "card.measure.distinctcount": "Distinct of {column}",
    "card.share": "{pct}% of total",
    "card.distinct": "Distinct {column}",
    "card.rows": { one: "{selected} of {total} row", other: "{selected} of {total} rows" },
    "qualify.too_small_heading": "Needs a bigger tile",
    "qualify.refusal_unspecified": "refused for the fields as bound - no single requirement to name",
    "qualify.count": "{matched} of {total}",
    "qualify.count_more": "{matched} of {total} (+{more})",
    "review.title": "Apply improvements?",
    "review.fallback_reason": "The AI review suggests a change to this chart.",
    "review.cost": "Applying creates a new chart version and uses a generation. Declining costs nothing more.",
    "review.decline": "No thanks",
    "review.accept": "Apply",
    "summary.warning": "Warning: {message}",
    // The point map's place-role decisions (pointRoleFactText), every key the wording reads.
    ...POINT_ROLE_FACT_ENGLISH,
    // The deterministic (trivial) charts' words, read at render time through RenderOptions.text.
    "trivial.blank": "(blank)",
    "trivial.value": "Value",
    "trivial.count_title": { one: "{name} — count of {count} row", other: "{name} — count of {count} rows" },
    "trivial.distribution_title": { one: "{name} — distribution of {count} value", other: "{name} — distribution of {count} values" },
    "trivial.reason.card": "One row of one column holds a single value, so this is a card. No generation was needed and none was used.",
    "trivial.reason.histogram": "A single numeric column has one defensible chart: the distribution of its values. No generation was needed and none was used.",
    "trivial.reason.frequency": "A single categorical column has one defensible chart: how often each value occurs. No generation was needed and none was used.",
};
const TIER1 = "nl de fr es pt it ru uk pl cs sk sv da nb fi hu tr el ro hr ja zh ko ar he hi id vi th".split(" ");
const ph = (s: string) => (s.match(/\{[a-z][a-z0-9_]*\}/g) ?? []).sort().join(",");

describe("chart-host's catalogs", () => {
    it("carry every Tier 1 language but English", () => {
        expect(Object.keys(HOST_TEXT_CATALOGS).sort()).toEqual([...TIER1].sort());
    });

    for (const lang of TIER1) {
        it(`${lang}: every key, the English placeholders, exactly the language's plural forms`, () => {
            const cat = HOST_TEXT_CATALOGS[lang];
            const cats = new Intl.PluralRules(lang).resolvedOptions().pluralCategories.slice().sort();
            for (const [key, en] of Object.entries(ENGLISH)) {
                const v = cat[key];
                expect(v, `${lang} ${key}`).toBeDefined();
                if (typeof en === "string") {
                    expect(typeof v, `${lang} ${key}`).toBe("string");
                    expect(ph(v as string), `${lang} ${key}`).toBe(ph(en));
                } else {
                    expect(Object.keys(v as object).sort(), `${lang} ${key}`).toEqual(cats);
                    for (const form of Object.values(v as Record<string, string>)) expect(ph(form), `${lang} ${key}`).toBe(ph(en.other));
                }
            }
            expect(Object.keys(cat).filter(k => !(k in ENGLISH)), `${lang} extra keys`).toEqual([]);
        });
    }
});

describe("chartHostStrings", () => {
    it("reads a culture's language and its regional variants, and nothing for English", () => {
        expect(chartHostStrings("de-DE")?.lang).toBe("de");
        expect(chartHostStrings("es-MX")?.lang).toBe("es");
        expect(chartHostStrings("ja")?.lang).toBe("ja");
        expect(chartHostStrings("en-GB")).toBeNull();
    });

    it("words the card in the reader's language, the field's own name kept", () => {
        const payload = {
            columns: [{ name: "City", dataType: "String", isMeasure: false }, { name: "Revenue", dataType: "Double", isMeasure: true },
                      { name: "__rowIdx__", dataType: "Int64", isMeasure: false }],
            rows: [["Denver", 100, 0], ["Miami", 300, 1]],
        } as any;
        const en = computeSelectionCard(payload, [0], {})!;
        for (const lang of TIER1) {
            const card = computeSelectionCard(payload, [0], { strings: chartHostStrings(lang), cultureCode: lang })!;
            expect(card.rowsText, lang).not.toBe(en.rowsText);
            expect(card.lines[0].label, lang).toContain("Revenue");
            expect(card.lines[0].label, lang).not.toBe(en.lines[0].label);
        }
    });
});

// The review that proposes a fix is itself charged, so the dialog says declining costs nothing MORE. Each language's
// earlier sentence said declining costs nothing at all; none of them may survive the change of meaning.
const REVIEW_COST_RETIRED: Record<string, string> = {
    ar: "يؤدي التطبيق إلى إنشاء إصدار جديد من المخطط ويستهلك عملية إنشاء واحدة. الرفض لا يكلف شيئاً.",
    cs: "Použitím vznikne nová verze grafu a spotřebuje se jedno generování. Odmítnutí nic nestojí.",
    da: "Hvis du anvender, oprettes en ny diagramversion, og der bruges en generering. Det koster intet at afvise.",
    de: "Beim Anwenden entsteht eine neue Diagrammversion, und eine Generierung wird verbraucht. Ablehnen kostet nichts.",
    el: "Η εφαρμογή δημιουργεί νέα έκδοση του γραφήματος και χρησιμοποιεί μία δημιουργία. Η απόρριψη δεν κοστίζει τίποτα.",
    es: "Aplicar crea una nueva versión del gráfico y usa una generación. Rechazar no cuesta nada.",
    fi: "Käyttöönotto luo kaaviosta uuden version ja kuluttaa yhden luonnin. Hylkääminen ei maksa mitään.",
    fr: "Appliquer crée une nouvelle version du graphique et utilise une génération. Refuser ne coûte rien.",
    he: "החלה יוצרת גרסה חדשה של התרשים ומשתמשת ביצירה אחת. דחייה לא עולה דבר.",
    hi: "लागू करने से चार्ट का नया संस्करण बनता है और एक जनरेशन उपयोग होता है। अस्वीकार करना निःशुल्क है।",
    hr: "Primjena stvara novu verziju grafikona i troši jedno generiranje. Odbijanje ne košta ništa.",
    hu: "Az alkalmazás új diagramverziót hoz létre, és felhasznál egy generálást. Az elutasítás ingyenes.",
    id: "Menerapkan akan membuat versi bagan baru dan menggunakan satu pembuatan. Menolak tidak dikenai biaya.",
    it: "Applicare crea una nuova versione del grafico e usa una generazione. Rifiutare non costa nulla.",
    ja: "適用すると新しいグラフ バージョンが作成され、生成を 1 回使用します。適用しない場合、費用はかかりません。",
    ko: "적용하면 새 차트 버전이 만들어지고 생성 1회가 사용됩니다. 거절하면 비용이 들지 않습니다.",
    nb: "Hvis du bruker dem, opprettes en ny diagramversjon, og én generering brukes. Å avslå koster ingenting.",
    nl: "Toepassen maakt een nieuwe grafiekversie en gebruikt een generatie. Weigeren kost niets.",
    pl: "Zastosowanie tworzy nową wersję wykresu i zużywa jedno generowanie. Odrzucenie nic nie kosztuje.",
    pt: "Aplicar cria uma nova versão do gráfico e usa uma geração. Recusar não tem custo.",
    ro: "Aplicarea creează o nouă versiune a diagramei și folosește o generare. Refuzul nu costă nimic.",
    ru: "Применение создаёт новую версию диаграммы и расходует одну генерацию. Отказ ничего не стоит.",
    sk: "Použitím vznikne nová verzia grafu a spotrebuje sa jedno generovanie. Odmietnutie nič nestojí.",
    sv: "Om du tillämpar skapas en ny diagramversion och en generering används. Att avböja kostar ingenting.",
    th: "การใช้จะสร้างแผนภูมิเวอร์ชันใหม่และใช้การสร้าง 1 ครั้ง การปฏิเสธไม่มีค่าใช้จ่าย",
    tr: "Uygulamak yeni bir grafik sürümü oluşturur ve bir oluşturma kullanır. Reddetmek ücretsizdir.",
    uk: "Застосування створює нову версію діаграми й витрачає одну генерацію. Відмова нічого не коштує.",
    vi: "Áp dụng sẽ tạo một phiên bản biểu đồ mới và dùng một lượt tạo. Từ chối thì không mất phí.",
    zh: "应用会创建新的图表版本并使用一次生成。拒绝不产生任何费用。",
};

describe("the review dialog's cost sentence", () => {
    it("says declining costs nothing more, in English and in every language", () => {
        expect(ENGLISH["review.cost"]).toMatch(/Declining costs nothing more\.$/);
        for (const lang of TIER1) {
            const retired = REVIEW_COST_RETIRED[lang];
            const now = HOST_TEXT_CATALOGS[lang]["review.cost"] as string;
            expect(now, lang).not.toBe(retired);
            // What applying costs did not change, so the first sentence keeps its wording.
            const firstEnd = [". ", "। ", "。", " การ"].map(sep => retired.indexOf(sep)).filter(i => i > 0)[0];
            expect(firstEnd, lang).toBeGreaterThan(0);
            expect(now.startsWith(retired.slice(0, firstEnd)), lang).toBe(true);
        }
    });
});
