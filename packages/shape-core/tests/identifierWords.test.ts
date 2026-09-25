import { describe, it, expect } from "vitest";
import { localizedIdentifierWordIn, IDENTIFIER_WORDS, IDENTIFIER_HEAD_INITIAL } from "../src/vocab/identifierWords";
import { isIdentifierName, classifyNumericValueNature } from "../src/indexedText";
import { VOCABULARY_LANGUAGE_CODES } from "../src/languages";

describe("identifier words - where each language puts them", () => {
    it.each([
        // head-final: the last word, the end of a compound, the end of a run
        ["Kundennummer", "de"], ["Kunden-Nr", "de"], ["KundenNr", "de"], ["Artikelnummer", "de"], ["PLZ", "de"],
        // a word several languages share answers with the first of them in the table (de lists nummer first)
        ["Klantnummer", "de"], ["Kundnummer", "de"], ["Asiakastunnus", "fi"], ["Termékkód", "hu"],
        ["Müşteri numarası", "tr"], ["Müsteri numarasi", "tr"], ["Sirket kodu", "tr"],
        ["客户编号", "zh"], ["产品代码", "zh"], ["顧客番号", "ja"], ["商品コード", "ja"], ["고객번호", "ko"], ["상품코드", "ko"],
        // head-initial: the first word, after a default aggregation prefix
        ["Código Cliente", "es"], ["Código", "es"], ["Suma de Código Postal", "es"], ["CEP Cliente", "pt"],
        ["Codice Fiscale", "it"], ["Numéro de commande", "fr"], ["Numer zamówienia", "pl"], ["Kód produktu", "pl"], ["Číslo objednávky", "cs"],
        ["Šifra artikla", "hr"], ["Код товара", "ru"], ["Номер заказа", "ru"], ["Κωδικός πελάτη", "el"],
        ["رمز العميل", "ar"], ["الرمز", "ar"], ["קוד לקוח", "he"], ["Kode Pelanggan", "id"], ["Mã khách hàng", "vi"],
        ["รหัสลูกค้า", "th"],
    ])("%s is an identifier (%s)", (name, lang) => {
        expect(localizedIdentifierWordIn(name)?.lang).toBe(lang);
        expect(isIdentifierName(name)).toBe(true);
    });

    it.each([
        // a count is not an identifier
        "Número de clientes", "Numero clienti", "Nombre de clients", "Număr de clienți", "Broj kupaca",
        "Αριθμός πελατών", "Anzahl Kunden", "Количество заказов", "Liczba zamówień",
        // an English name with a head-initial word in first position is not read as that language
        "Code Coverage", "COD Amount", "Cap Rate", "Key Metric",
        // the word in the other language's position
        "Cliente Código", "Pedido Numéro", "Nummer Kunden",
        // a word that merely contains a token
        "Partner", "Nummerierung", "Codigoasta",
        // Spanish without the accent is still the count word; numero alone is not French
        "Numero", "Número",
    ])("%s is not", (name) => {
        expect(localizedIdentifierWordIn(name)).toBeNull();
    });

    it("English is read first and unchanged", () => {
        for (const n of ["CustomerID", "Zip", "StoreKey", "ProductCode", "Postal Code"]) expect(isIdentifierName(n)).toBe(true);
        for (const n of ["Customer Number", "Order No", "Revenue", "Postcode", "Sales Quota"]) expect(isIdentifierName(n)).toBe(false);
    });

    it("the table is vocabulary languages only, and every head-initial language has words", () => {
        for (const lang of Object.keys(IDENTIFIER_WORDS)) expect(VOCABULARY_LANGUAGE_CODES).toContain(lang);
        for (const lang of IDENTIFIER_HEAD_INITIAL) expect(IDENTIFIER_WORDS[lang]?.length).toBeGreaterThan(0);
    });

    it("an identifier-named integer measure is nominal, as an English one is", () => {
        const base = { dataType: "Integer", isMeasure: false, distinct: 900, nonblank: 1000, prec: 0, minval: 10000, maxval: 99999 };
        expect(classifyNumericValueNature({ ...base, name: "Kundennummer" })).toBe("Categorical");
        expect(classifyNumericValueNature({ ...base, name: "CustomerID" })).toBe("Categorical");
        expect(classifyNumericValueNature({ ...base, name: "Número de clientes" })).toBe("Continuous");
    });
});
