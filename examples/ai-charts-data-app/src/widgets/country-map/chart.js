// BIC generated chart — World Choropleth [D3]
// host contract v1.24.0. A host implementing a DIFFERENT major
// version may not interoperate with this file's mark/slot grammar.
// Regenerate with the MCP generate_chart tool — hand edits are lost.
// bic:keyboard-marks
// SHARED value-channel resolver. Answers ONE question for any chart that reduces rows to a
// value per group: WHICH COLUMN CARRIES THE NUMBER? It draws nothing and it decides nothing
// about geometry, exactly like the bounded-scale resolver does for the gauge family.
//
// WHY THIS EXISTS, and it is not a tidy-up. Every chart that needed a value used to write
//
//     const measIdx = columns.findIndex(c => c.isMeasure);
//     const mv = measIdx >= 0 ? row[measIdx] : 1;
//
// and that is wrong twice over. `isMeasure` is true ONLY for a column bound in the measures
// role; a numeric column bound as a category arrives with isMeasure false and every one of its
// statistics intact, so the flag alone throws away a perfectly good measure. And the fallback
// then substitutes the literal 1, which does not fail - it fabricates. Every group aggregates
// to the same number, a colour ramp collapses to a single tone with a legend annotated 1 at
// both ends, a width scale hands every mark its maximum, and the chart renders cleanly, passes
// every execution gate and answers a question nobody asked. A silent constant is far worse than
// a missing channel, because nothing downstream can tell it apart from real data.
//
// CONTRACT
//   const V = d3.llmValueColumn(columns, rows, { countLabel: 'Rows', exclude: [iLat, iLon] });
//   V.valueIndex   column index of the value, or -1 when the rows are being counted
//   V.valueName    what to PUT ON THE LEGEND - the column's name, or countLabel when counting
//   V.labelIndex   the dimension to label a group with; never the same column as the value
//   V.isCount      true when no value column existed and each row therefore counts as one
//   V.resolvedBy   'measure' | 'numeric' | 'count' - which rule fired, for gates and tooltips
//   V.valueOf(row) the row's numeric contribution, or null for blank. NEVER coerces blank to 0.
//   V.measures     every flagged measure that IS a quantity, in bound order - rule 1's candidates - for a
//                  chart with more than one value channel (x, y, size, colour, a component)
//
// d3.llmValueColumn.nameWords(name) is the ONE word reader for a column name the lanes share: camelCase
// split (a lower-case letter or digit, then an upper-case one, in any script), lower-cased, split on
// everything that is not a letter or mark - digits included. It is the client twin of the server's
// coordinate reader (ChartFilter.CoordinateNameTokens = NameReader.Tokens, camel on, digits out), so
// `SiteLongitude`, `site_longitude` and `Site Longitude` all read [site, longitude] on both sides.
// A test that lower-cases BEFORE it splits reads `SiteLongitude` as one word and misses it.
//
// Resolution order:
//   0. opts.prefer - a column the CALLER has already resolved, by name or index. Honoured first
//      and without argument. This exists because a lane can REQUIRE this helper be called, and a
//      required call must never be a reason to discard a correct answer the caller already had.
//   1. the first column flagged isMeasure that is a QUANTITY: not text, not an identifier and not
//      a date key. A numeric dimension can arrive flagged as a measure (a host promotes it, or a
//      reader drops it in the measure well), and the flag does not turn an order number or a
//      yyyymmdd key into an amount - an OD flow map sized every arc by a flagged CustomerID;
//   2. else the first NUMERIC column that is neither host-injected, nor the label, NOR AN
//      IDENTIFIER, NOR A DATE KEY - a measure the user bound as a category is still the measure they
//      meant, but a ZIP code, a FIPS code or an order number is a NAME WRITTEN IN DIGITS and summing it
//      produces a chart that renders cleanly and means nothing;
//   3. else count the rows, and SAY SO. isCount is the caller's instruction to label the
//      channel as a count rather than borrow a column name for a number that is not that column.
//
// WHY RULE 2 NEEDED THE IDENTIFIER TEST. A US cartogram over ZipCode / City / State / Channel /
// Orders / Revenue arrived with every column isMeasure:false - which is what a dataset well does
// when the user binds fields as categories - so rule 1 found nothing and rule 2 took ZipCode, the
// first numeric. The 51 state tiles were coloured by the SUM OF ZIP CODE, legend reading 42,791
// to 60,294,573, while Revenue went unencoded. It passed every gate, because there is nothing
// wrong with the drawing; the number is just not about anything.
//
// WHAT COUNTS AS AN IDENTIFIER, strongest evidence first:
//   - the host says so: a `geoKind` that is a REGION JOIN CODE (zip / state / county / FIPS /
//     ISO / country). A latitude is numeric, geographic and a real quantity, so coordinate kinds
//     are NOT identifiers;
//   - failing that, the NAME says so AND the data agrees: an id-ish token in the column name
//     (camelCase and underscore both split, so `ZipCode` and `zip_code` read alike) together
//     with an integer type and near-unique values. All three, because `OrderCount` is an
//     integer, `Revenue` is near-unique, and neither is an identifier.
// A pure uniqueness sniff is deliberately NOT used: Revenue was 9,381 distinct over 10,000 rows.
//
// A FLAGGED MEASURE is held to a stricter name test, because the flag is evidence too: the name's HEAD - its last
// word (`CustomerID`, `ZipCode`) or a leading `id` (`ID_Zona`) - must name nothing but an identifier (id, key,
// guid, sku, zip, serial...), and its values must be integers, so `AccountBalance` stays an amount. A head that can
// also name a quantity (number, num, no, code, ref) never decides, however unique the values - near-uniqueness
// cannot tell an id from a summed measure (`Sum of new_num`, a numerator) - unless it follows a strong word
// (`Zip Code`, `Serial Number`). A name that COUNTS (`Count of CustomerID`, `Nombre de presentation_id`) is a
// quantity of identifiers, never an identifier.
//
// A DATE KEY is a date written as one integer, yyyymmdd (19000101-21001231 with a real month and day) or
// yyyymm, under a name that says key, date, period or month - every value must read so, and the name is
// required because a revenue of 200,103 to 200,912 fits the pattern by chance. A flagged region code is a key
// only under a code-like name (zip, postal, fips, code, iso, geoid): a host once tagged `Radius(mm)` us-zip5.
// Both are the server's tests (ChartFilter.IsNeverAQuantity, read as words by the same reader), so the prompt's
// value candidates and this resolver name the same columns.
//
// opts.prefer names the column the caller has ALREADY decided is the value - a name or an index.
// Use it when a lane requires this call but you have resolved the value yourself: the required
// call then CONFIRMS your answer instead of replacing it. Ignored when it names nothing real.
//
// opts.exclude is a list of column INDEXES the caller has already claimed for another channel -
// a flow map resolves its own lat/lon pair out of ordinary named columns, and a latitude drafted
// as the value would be worse than counting. Say what you have taken; the resolver skips it for
// both the value and the label.
//
// opts.excludeCoordinates (opt-in) - A COORDINATE IS NEVER THE VALUE. A route or point map resolves its ends from the
// host's reserved columns or from columns it names itself, and the data's OWN latitude and longitude columns stay
// candidates: a numeric dimension with many values can arrive flagged as a measure, and a flow map sized every arc by
// DestinationLatitude under a key titled 'DestinationLatitude' - it rendered cleanly and passed every gate. With the
// option set, the resolver skips (for the value AND the label) every column that NAMES a coordinate - camelCase and
// separators split, any word lat, latitude, lon, lng or longitude; 'long' only when every value is a longitude, so
// 'LongHaulUnits' stays a measure - or that the host DECLARES one (semanticType or dataCategory Latitude / Longitude);
// host columns are skipped already. With nothing else left it counts. V.coordinates names what it skipped. Opt-in,
// because a latitude IS a quantity on a chart that plots it.
//
// An implicit count is legitimate. Reaching it while a real number sits unread is not.
d3.llmValueColumn = function (columns, rows, opts) {
  opts = opts || {};
  var cols = Array.isArray(columns) ? columns : [];
  var data = Array.isArray(rows) ? rows : [];

  // Host-injected columns are plumbing - join keys, row ids, resolved coordinates. They are
  // numeric and they are never what anyone bound, so they can never be a value or a label.
  var isHost = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    return n.indexOf('__') === 0;
  };
  var taken = {};
  (Array.isArray(opts.exclude) ? opts.exclude : []).forEach(function (i) {
    if (i != null && i >= 0) taken[i] = 1;
  });
  var coordinates = [];
  if (opts.excludeCoordinates) {
    var coordWords = d3.llmValueColumn.nameWords;
    var allLongitudes = function (ci) {
      var seenL = 0;
      for (var rr = 0; rr < data.length; rr++) {
        var lv = data[rr] ? data[rr][ci] : null;
        if (lv === null || lv === undefined || lv === '') continue;
        lv = +lv; seenL++;
        if (!isFinite(lv) || lv < -180 || lv > 180) return false;
      }
      return seenL > 0;
    };
    cols.forEach(function (c, ci) {
      if (!c || isHost(c)) return;
      var declared = String(c.semanticType || c.dataCategory || '').toLowerCase();
      var w = coordWords(c.name);
      if (declared === 'latitude' || declared === 'longitude'
          || w.some(function (t) { return /^(lat|latitude|lon|lng|longitude)$/.test(t); })
          || (w.indexOf('long') >= 0 && allLongitudes(ci))) {
        taken[ci] = 1;
        coordinates.push(String(c.name));
      }
    });
  }

  var NUMERIC_TYPES = { integer: 1, decimal: 1, double: 1, float: 1, single: 1,
                        number: 1, int64: 1, int32: 1, currency: 1, money: 1 };

  // A column is numeric if the host SAYS so, and otherwise if the rows show it. The declared
  // type is preferred because a sparse column of blanks is still numeric; the sniff is the
  // fallback for a payload that carries no type at all.
  var isNumericCol = function (c, i) {
    var dt = (c && c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (dt) return NUMERIC_TYPES[dt] === 1;
    var seen = 0, num = 0;
    for (var r = 0; r < data.length && seen < 50; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      if (typeof v !== 'boolean' && isFinite(+v)) num++;
    }
    return seen > 0 && num === seen;
  };

  // A GEO JOIN CODE IS A NAME, NOT A NUMBER. Region codes identify; coordinates measure.
  var isRegionCode = function (c) {
    var k = (c && c.geoKind != null) ? String(c.geoKind).toLowerCase() : '';
    if (!k) return false;
    return k.indexOf('zip') === 0 || k.indexOf('us-zip') === 0 || k.indexOf('us-state') === 0 ||
           k.indexOf('us-county') === 0 || k.indexOf('us-fips') === 0 || k.indexOf('fips') === 0 ||
           k.indexOf('country-') === 0 || k.indexOf('iso-') === 0;
  };

  // Split a column name the way a reader does - camelCase AND underscores AND spaces - because a
  // word-boundary test cannot see the `Code` inside `ZipCode`, and glued names are the common case.
  var ID_TOKENS = { id: 1, ids: 1, identifier: 1, code: 1, codes: 1, zip: 1, zipcode: 1,
                    postal: 1, postcode: 1, fips: 1, guid: 1, uuid: 1, sku: 1, upc: 1, ean: 1,
                    isbn: 1, key: 1, num: 1, number: 1, no: 1, ref: 1, serial: 1, barcode: 1,
                    account: 1, acct: 1, vin: 1, imei: 1, ssn: 1 };
  var nameLooksLikeId = function (c) {
    var n = (c && c.name != null) ? String(c.name) : '';
    if (!n) return false;
    var parts = n.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/);
    for (var p = 0; p < parts.length; p++) {
      if (parts[p] && ID_TOKENS[parts[p].toLowerCase()] === 1) return true;
    }
    return false;
  };

  // The name alone is not enough - `OrderCount` would be a false positive on a token list, and a
  // measure lost to a name test is as wrong as an identifier drafted as a measure. Require the
  // DATA to agree: integer-valued and near-unique, which is what a key looks like and what a
  // quantity almost never does.
  var looksLikeKeyData = function (c, i) {
    var seen = 0, ints = 0, vals = {}, distinct = 0;
    for (var r = 0; r < data.length && seen < 2000; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '') continue;
      seen++;
      var num = +v;
      if (isFinite(num) && Math.floor(num) === num) ints++;
      var kk = String(v);
      if (vals[kk] !== 1) { vals[kk] = 1; distinct++; }
    }
    return seen >= 8 && ints === seen && (distinct / seen) >= 0.9;
  };

  var isIdentifierCol = function (c, i) {
    if (!c) return false;
    // geoKind is DECLARED by the host and is the exact signal, so it is tested first and alone.
    // There is deliberately no second declared flag to consult: formatSignature, the host's other
    // identifier signal, is computed for STRING columns only - which is precisely why a numeric
    // ZIP slipped past every identifier test in the pipeline - and inventing a field nothing
    // populates would be a lever that cannot fire.
    if (isRegionCode(c)) return true;
    return nameLooksLikeId(c) && looksLikeKeyData(c, i);
  };

  // A FLAGGED MEASURE IS AN IDENTIFIER only when its name's HEAD - its last word, or a leading `id` - names
  // nothing but an identifier, and its values are integers. The flag is evidence of a quantity, so
  // `AccountBalance` (an `account` that is not the head) stays an amount, and a name that COUNTS identifiers
  // (`Count of CustomerID`, `Nombre de presentation_id`) is a quantity. A head that can also name a quantity -
  // number, num, no, code, ref - never decides: near-unique values cannot tell an id from a summed measure, and
  // prod's weekly `Sum of new_num`, a numerator, read as a key. ChartFilter.IsNeverAQuantity holds the same rule.
  var STRONG_ID_HEADS = { id: 1, ids: 1, identifier: 1, key: 1, zip: 1, zipcode: 1, postal: 1, postcode: 1, fips: 1,
                          guid: 1, uuid: 1, sku: 1, upc: 1, ean: 1, isbn: 1, serial: 1, barcode: 1, vin: 1, imei: 1, ssn: 1 };
  var WEAK_ID_TAILS = { code: 1, codes: 1, number: 1, num: 1, no: 1, nbr: 1, ref: 1 };
  var allIntegers = function (i) {
    var seen = 0;
    for (var r = 0; r < data.length && seen < 2000; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '' || typeof v === 'boolean') continue;
      var n = +v;
      if (!isFinite(n) || Math.floor(n) !== n) return false;
      seen++;
    }
    return seen > 0;
  };
  // Power BI writes an implicit count in the report's language - 'Nombre de presentation_id', 'Contagem de Project ID',
  // 'Anzahl von KundenID' - and a count of identifiers is a quantity. The same words as the server's
  // ChartFilter.CountsSomething, accented and folded spellings both.
  var COUNT_WORDS = { count: 1, countd: 1, distinct: 1, recuento: 1, contagem: 1, anzahl: 1, aantal: 1, conteggio: 1,
                      antal: 1, antall: 1, lukumaara: 1, 'lukum\u00e4\u00e4r\u00e4': 1, pocet: 1, 'po\u010det': 1, liczba: 1 };
  var NUMBER_OF = { number: 1, num: 1, no: 1, nombre: 1 };
  var OF_WORDS = { of: 1, de: 1, du: 1, des: 1 };
  var countsSomething = function (c, w) {
    if (/^\s*#/.test(String(c.name))) return true;
    for (var k = 0; k < w.length; k++) {
      if (COUNT_WORDS[w[k]] === 1) return true;
      if (NUMBER_OF[w[k]] === 1 && OF_WORDS[w[k + 1]] === 1) return true;
    }
    return false;
  };
  var CODE_WORDS = { zip: 1, zipcode: 1, postal: 1, postcode: 1, fips: 1, code: 1, iso: 1, geoid: 1 };
  var isFlaggedIdentifier = function (c, i) {
    if (!c) return false;
    var w = d3.llmValueColumn.nameWords(c.name);
    // A REGION CODE IS A KEY UNDER A CODE-LIKE NAME: the host's geoKind alone once tagged a `Radius(mm)` measure us-zip5.
    if (isRegionCode(c)) for (var cw = 0; cw < w.length; cw++) if (CODE_WORDS[w[cw]] === 1) return true;
    if (!w.length || countsSomething(c, w)) return false;
    var head = w[w.length - 1];
    // A weak id word after a strong one names the strong one's kind: Zip Code, Serial Number, ISBN No.
    if (WEAK_ID_TAILS[head] === 1 && w.length > 1 && STRONG_ID_HEADS[w[w.length - 2]] === 1) head = w[w.length - 2];
    if (!(STRONG_ID_HEADS[head] === 1 || w[0] === 'id')) return false;
    // The name decides, so a one-row KPI table's CustomerID is a key as surely as a 26,000-row one.
    return allIntegers(i);
  };

  // A DATE KEY IS A DATE WRITTEN AS ONE INTEGER - yyyymmdd, or yyyymm - and summing, ramping or sizing by
  // it draws a number about nothing (a 3D scatter sized its points by OrderDateKey). Every value must
  // read as a real date AND the name must say key, date, period or month - the server's words.
  var DATE_KEY_WORDS = { key: 1, date: 1, period: 1, month: 1, yyyymm: 1, yyyymmdd: 1, ym: 1, ymd: 1 };
  var isDateKey = function (c, i) {
    if (!c) return false;
    var w = d3.llmValueColumn.nameWords(c.name), named = false;
    for (var k = 0; k < w.length; k++) if (DATE_KEY_WORDS[w[k]] === 1) { named = true; break; }
    if (!named) return false;
    var seen = 0, ymd = 0, ym = 0;
    for (var r = 0; r < data.length && seen < 2000; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '' || typeof v === 'boolean') continue;
      var n = +v;
      if (!isFinite(n) || Math.floor(n) !== n) return false;
      seen++;
      if (n >= 19000101 && n <= 21001231) {
        var mo = Math.floor(n / 100) % 100, dd = n % 100;
        if (mo >= 1 && mo <= 12 && dd >= 1 && dd <= 31) ymd++;
      } else if (n >= 190001 && n <= 210012) {
        var m2 = n % 100;
        if (m2 >= 1 && m2 <= 12) ym++;
      }
    }
    return seen > 0 && (ymd === seen || ym === seen);
  };

  // A MEASURE THAT HOLDS TEXT IS NOT A VALUE. Power BI's "First" or "Last" of a name is a measure the
  // host sends as a string: taken as the value, valueOf answers null on every row and the chart draws
  // nothing - the card of dashes nine archetypes were fixed for. The same rule as the server's
  // ChartFilter.IsTextMeasure: DECLARED non-numeric (not a date, not a flag) with no numeric evidence
  // (no spread, sum or mean, not continuous). An untyped measure is still taken: no type is not text.
  var isTextMeasure = function (c) {
    if (!c || !c.isMeasure) return false;
    var dt = (c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    if (!dt || NUMERIC_TYPES[dt] === 1 || dt === 'datetime' || dt === 'date' || dt === 'boolean') return false;
    if (c.stdDev != null || c.sum != null || c.avgValue != null) return false;
    return String(c.valueNature || '').toLowerCase() !== 'continuous';
  };

  var valueIndex = -1, resolvedBy = 'count';
  var skipped = [];
  var skippedText = [];      // measures passed over because they hold text (isTextMeasure)

  // 0. THE CALLER'S OWN ANSWER WINS. A lane that REQUIRES this call must not thereby cost the
  //    caller a value it had already resolved correctly.
  if (opts.prefer != null) {
    var want = opts.prefer;
    for (var q = 0; q < cols.length; q++) {
      if (!cols[q]) continue;
      if (q === want || (typeof want === 'string' && String(cols[q].name) === want)) {
        if (!taken[q] && !isHost(cols[q])) { valueIndex = q; resolvedBy = 'preferred'; }
        break;
      }
    }
  }

  // A flagged measure that is not a quantity: text, an identifier or a date key.
  var refused = {};
  var notAQuantity = function (c, ci) {
    if (refused[ci] !== undefined) return refused[ci];
    return (refused[ci] = isTextMeasure(c) ? 'text' : ((isFlaggedIdentifier(c, ci) || isDateKey(c, ci)) ? 'key' : ''));
  };
  // Every flagged measure that IS a quantity, in bound order: rule 1's candidates, and what a chart with
  // more than one value channel draws from.
  // THE PROFILER'S CONTINUITY RULE for a column nobody profiled (shape-core classifyNumericValueNature, its non-measure
  // branch, with the same constants): a name whose LAST word names an identifier is a code; a densely consecutive run
  // that reads as calendar years, a 0-20 level scale, or carries an ordinal word is an axis; otherwise more than 12
  // distinct values that are fractional, or at least 100, or at least 30% unique, are a measured quantity.
  var IDENT_LAST = { id: 1, ids: 1, uuid: 1, guid: 1, key: 1, zip: 1, zipcode: 1, postal: 1, postalcode: 1, ssn: 1,
                     code: 1, codes: 1, sku: 1, isbn: 1, msisdn: 1, imei: 1 };
  var ORDINAL_WORDS = { hour: 1, hr: 1, day: 1, dow: 1, dom: 1, weekday: 1, week: 1, wk: 1, woy: 1, month: 1, mth: 1,
                        quarter: 1, qtr: 1, year: 1, yr: 1, semester: 1, trimester: 1, decade: 1, period: 1, fiscal: 1,
                        fy: 1, rank: 1, level: 1, lvl: 1, tier: 1, grade: 1, band: 1, decile: 1, percentile: 1,
                        quartile: 1, quintile: 1, score: 1, rating: 1, stars: 1, step: 1, stage: 1, phase: 1, round: 1,
                        wave: 1, episode: 1, chapter: 1, age: 1, cohort: 1, generation: 1, seniority: 1, position: 1,
                        sequence: 1, seq: 1, priority: 1 };
  var looksContinuous = function (c, i) {
    var w = d3.llmValueColumn.nameWords(c.name);
    if (w.length && IDENT_LAST[w[w.length - 1]] === 1) return false;
    if (d3.llmValueColumn.localizedIdentifierWord(c.name)) return false;
    var dt = (c && c.dataType != null) ? String(c.dataType).toLowerCase() : '';
    var hasFraction = false, seenV = {}, distinct = 0, nonblank = 0, mn = Infinity, mx = -Infinity;
    for (var r = 0; r < data.length; r++) {
      var v = data[r] ? data[r][i] : null;
      if (v == null || v === '' || typeof v === 'boolean') continue;
      var n = +v;
      if (!isFinite(n)) continue;
      nonblank++;
      var key = String(v);
      if (seenV[key] !== 1) { seenV[key] = 1; distinct++; }
      if (n < mn) mn = n;
      if (n > mx) mx = n;
      if (Math.floor(n) !== n) hasFraction = true;
    }
    if (nonblank === 0) return false;
    var fractional = hasFraction || dt === 'decimal' || dt === 'double' || dt === 'float' || dt === 'single'
                     || dt === 'currency' || dt === 'money';
    var span = mx - mn + 1, density = span > 0 ? distinct / span : 1;
    if (density >= 0.9) {
      for (var k = 0; k < w.length; k++) if (ORDINAL_WORDS[w[k]] === 1 && distinct <= 120) return false;
      if (mn >= 1900 && mx <= 2100) return false;
      if (mn >= 0 && mx <= 20) return false;
    }
    return distinct > 12 && (fractional || distinct >= 100 || distinct / nonblank >= 0.30);
  };
  var measures = [];
  for (var mi = 0; mi < cols.length; mi++) {
    if (taken[mi] || !cols[mi] || !cols[mi].isMeasure || isHost(cols[mi])) continue;
    if (!notAQuantity(cols[mi], mi)) measures.push(mi);
  }
  // NOTHING FLAGGED AND NOTHING PROFILED: the measures the shape promoted. A host that never profiled its columns (the
  // Power BI visual on a freshly indexed data view) hands an unsummarised numeric bound as a category over with
  // isMeasure false, while the shape the code was written against promoted it to a measure - so `V.measures` came back
  // [] and the chart threw INVALID on every re-index and every reopen. Only when NO column is flagged and NO column
  // carries the profiler's statistics (valueNature, distinctCount) does the list fall back to the numeric columns the
  // profiler would have promoted: never a host column, an excluded one, an identifier or a date key, and continuous by
  // its rule. A host that profiled its columns (chart-host's hosts, the server's exec gate) never reaches this.
  var measuresInferred = false;
  var anyFlagged = false, anyProfiled = false;
  for (var fi = 0; fi < cols.length; fi++) {
    var fc = cols[fi];
    if (!fc || isHost(fc)) continue;
    if (fc.isMeasure) anyFlagged = true;
    if (fc.valueNature != null || fc.distinctCount != null) anyProfiled = true;
  }
  if (!anyFlagged && !anyProfiled) {
    for (var ni = 0; ni < cols.length; ni++) {
      if (taken[ni] || !cols[ni] || isHost(cols[ni])) continue;
      if (!isNumericCol(cols[ni], ni)) continue;
      if (isIdentifierCol(cols[ni], ni) || isDateKey(cols[ni], ni)) continue;
      if (!looksContinuous(cols[ni], ni)) continue;
      measures.push(ni);
    }
    measuresInferred = measures.length > 0;
  }

  if (valueIndex < 0) {
    for (var i = 0; i < cols.length; i++) {
      if (taken[i]) continue;
      if (!cols[i] || !cols[i].isMeasure || isHost(cols[i])) continue;
      // SAY WHAT WAS SKIPPED, as the numeric pass does for an identifier.
      var why = notAQuantity(cols[i], i);
      if (why === 'text') { skippedText.push(String(cols[i].name)); continue; }
      if (why === 'key') { skipped.push(String(cols[i].name)); continue; }
      valueIndex = i; resolvedBy = 'measure'; break;
    }
  }
  if (valueIndex < 0) {
    for (var j = 0; j < cols.length; j++) {
      if (taken[j] || !cols[j] || isHost(cols[j])) continue;
      if (!isNumericCol(cols[j], j)) continue;
      if (refused[j] === 'key') continue;          // a flagged key rule 1 already refused and named
      if (isIdentifierCol(cols[j], j) || isDateKey(cols[j], j)) {
        // SAY WHAT WAS SKIPPED. A silent exclusion is how the opposite bug would hide.
        skipped.push(String(cols[j].name));
        continue;
      }
      valueIndex = j; resolvedBy = 'numeric'; break;
    }
  }

  // The label is the first bound column that is NOT the value. Resolving the two together is
  // what stops a numeric column being drafted as the value and then labelling the groups with
  // itself - the two used to be found by separate scans that could agree on the same column.
  var labelIndex = -1;
  for (var k = 0; k < cols.length; k++) {
    if (taken[k] || !cols[k] || isHost(cols[k]) || k === valueIndex) continue;
    labelIndex = k; break;
  }

  var isCount = valueIndex < 0;
  var nameOf = function (idx) {
    var c = cols[idx];
    return (c && c.name != null) ? String(c.name) : '';
  };

  return {
    valueIndex: valueIndex,
    valueName: isCount ? (opts.countLabel || 'Rows') : nameOf(valueIndex),
    labelIndex: labelIndex,
    labelName: labelIndex >= 0 ? nameOf(labelIndex) : '',
    isCount: isCount,
    resolvedBy: resolvedBy,
    // Columns REFUSED as identifiers or date keys - flagged measures rule 1 passed over, numeric columns
    // rule 2 did. Non-empty here beside isCount true means "there were numbers and none of them were
    // quantities" - worth putting in a subtitle rather than hiding.
    skipped: skipped,
    // Measures passed over because they hold TEXT (a "First" of a name): kept apart from `skipped`,
    // which names identifiers, so a caption built from either says the right thing.
    skippedText: skippedText,
    // Columns opts.excludeCoordinates set aside as coordinates (empty when the option is off).
    coordinates: coordinates,
    // Every flagged measure that is a quantity, in bound order (indexes): never text, an identifier, a date
    // key, a host column or one the caller excluded (coordinates included, under excludeCoordinates).
    measures: measures,
    // True when the measures list was INFERRED (nothing flagged, nothing profiled), not read from flags.
    measuresInferred: measuresInferred,
    // A BLANK IS NOT A ZERO. Returning null keeps an absent value out of the aggregate and out
    // of the scale domain, so a group present in the data with nothing to show for this view
    // paints as no-data instead of being dragged to the bottom of the ramp.
    valueOf: function (row) {
      if (isCount) return 1;
      if (!row) return null;
      var v = row[valueIndex];
      if (v == null || v === '' || typeof v === 'boolean') return null;
      var n = +v;
      return isFinite(n) ? n : null;
    }
  };
};

// THE ONE WORD READER for a column name (see the header): NFC, a space at every camelCase boundary (a
// lower-case letter or a digit, then an upper-case letter, in any script), lower-cased, then split on
// every character that is not a letter or a mark - digits split away. The server's coordinate reader
// (ChartFilter.CoordinateNameTokens) reads the same words, so client and server agree on which column
// names a coordinate: `SiteLongitude` -> [site, longitude], `dest_lat` -> [dest, lat]. opts.digits keeps the
// digits inside a word (`Q1` -> [q1]), the server reader's digitsInWords, for a vocabulary that holds them.
d3.llmValueColumn.nameWords = function (name, opts) {
  var s = String(name == null ? '' : name);
  try { s = s.normalize('NFC'); } catch (e) { /* an unpaired surrogate: read it as it stands */ }
  s = s.replace(/([\p{Ll}\p{Nd}])(?=\p{Lu})/gu, '$1 ').toLowerCase();
  return s.split(opts && opts.digits ? /[^\p{L}\p{M}\p{N}]+/u : /[^\p{L}\p{M}]+/u)
    .filter(function (w) { return w.length > 0; });
};

// THE PROFILER'S OTHER-LANGUAGE IDENTIFIER WORDS (shape-core vocab/identifierWords.ts, read by isIdentifierName after the English last-word test).
// An unflagged, unprofiled integer named `Kundennummer`, `Codigo` or `Postleitzahl` is a label there (inferredMeasureFlags() is false), so the
// fallback in d3.llmValueColumn must not promote it to V.measures. Same words, same position (head-final languages: the LAST word; head-initial:
// the FIRST, after the host's default aggregation prefix), same views (whole word, compound end, Hangul end, Han/Kana end, Thai start, Arabic and
// Hebrew glued prefix), same fold. Words that are also a COUNT (es `numero`, fr `nombre`) or an English word in first position (fr `code`) are
// left out there and here. Source stays ASCII: every non-ASCII character is a \u escape.
d3.llmValueColumn.localizedIdentifierWord = (function () {
  var WORDS = {
    de: ['nr', 'nummer', 'kennung', 'kennziffer', 'plz', 'postleitzahl'],
    nl: ['nr', 'nummer'],
    sv: ['nr', 'nummer'],
    da: ['nr', 'nummer'],
    nb: ['nr', 'nummer'],
    fi: ['tunnus', 'koodi', 'nro'],
    hu: ['azonos\u00edt\u00f3', 'k\u00f3d'],
    tr: ['kod', 'kodu', 'numaras\u0131', 'numarasi'],
    zh: ['\u7f16\u53f7', '\u4ee3\u7801', '\u7f16\u7801', '\u53f7\u7801', '\u90ae\u7f16'],
    ja: ['\u756a\u53f7', '\u30b3\u30fc\u30c9'],
    ko: ['\ubc88\ud638', '\ucf54\ub4dc'],
    hi: ['\u0915\u094b\u0921', '\u0915\u094d\u0930\u092e\u093e\u0902\u0915'],
    fr: ['num\u00e9ro'],
    es: ['c\u00f3digo'],
    pt: ['c\u00f3digo', 'cep'],
    it: ['codice'],
    pl: ['kod', 'numer'],
    cs: ['k\u00f3d', '\u010d\u00edslo'],
    sk: ['k\u00f3d', '\u010d\u00edslo'],
    hr: ['\u0161ifra', 'oznaka'],
    ru: ['\u043a\u043e\u0434', '\u043d\u043e\u043c\u0435\u0440'],
    uk: ['\u043a\u043e\u0434', '\u043d\u043e\u043c\u0435\u0440'],
    el: ['\u03ba\u03c9\u03b4\u03b9\u03ba\u03cc\u03c2'],
    ar: ['\u0631\u0645\u0632', '\u0643\u0648\u062f', '\u0631\u0642\u0645'],
    he: ['\u05e7\u05d5\u05d3'],
    id: ['kode', 'nomor'],
    vi: ['m\u00e3'],
    th: ['\u0e23\u0e2b\u0e31\u0e2a']
  };
  var HEAD_INITIAL = ['fr', 'es', 'pt', 'it', 'pl', 'cs', 'sk', 'hr', 'ru', 'uk', 'el', 'ar', 'he', 'id', 'vi', 'th'];
  var COMPOUNDS = ['nl', 'de', 'sv', 'da', 'nb', 'fi', 'hu'];
  var NO_BREAKS = ['zh', 'ja', 'th'];
  var UNFOLDED = ['num\u00e9ro'];
  var GLUED = { ar: ['\u0627\u0644', '\u0648\u0627\u0644', '\u0628\u0627\u0644', '\u0641\u0627\u0644', '\u0643\u0627\u0644', '\u0644\u0644', '\u0648', '\u0641', '\u0628', '\u0643', '\u0644'], he: ['\u05d4', '\u05d5', '\u05d1', '\u05dc', '\u05de', '\u05e9', '\u05db', '\u05d5\u05d4', '\u05e9\u05d4', '\u05de\u05d4', '\u05d5\u05d1', '\u05d5\u05dc', '\u05d5\u05de', '\u05d1\u05d4', '\u05dc\u05d4'] };
  var DEFAULT_PREFIXES = ['somme de', 'suma de', 'soma de', 'summe von', 'som van', 'somma di', 'summa av', 'sum av', 'sum af', 'soucet z', 'suma z', 'totaal van', 'total de', 'toplam', 'osszeg', 'nombre de', 'recuento de', 'contagem de', 'anzahl von', 'aantal van', 'conteggio di', 'antal av', 'lukumaara', 'pocet z', 'sum pa', '\u0441\u0443\u043c\u043c\u0430', '\u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e', '\u0441\u0443\u043c\u0430', '\u043a\u0456\u043b\u044c\u043a\u0456\u0441\u0442\u044c', '\u03b1\u03b8\u03c1\u03bf\u03b9\u03c3\u03bc\u03b1', '\u03c0\u03bb\u03b7\u03b8\u03bf\u03c2'];
  var DEFAULT_SUFFIXES = ['osszege', 'sucet', '\u7684\u603b\u548c', '\u7684\u8ba1\u6570', '\u306e\u5408\u8a08', '\uc758 \ud569\uacc4'];
  var has = function (list, x) { return list.indexOf(x) >= 0; };
  var cpLen = function (s) { return Array.from(s).length; };
  var STROKE = { '\u0142': 'l', '\u0141': 'L', '\u0131': 'i', '\u00f8': 'o', '\u00d8': 'O', '\u0111': 'd', '\u0110': 'D', '\u00f0': 'd', '\u00d0': 'D' };
  var DIGIT_ZEROS = [0x0660, 0x06F0, 0x0966, 0x0E50, 0xFF10];
  // Length-preserving fold: a character is replaced only by a single BMP character (shape-core nameReader foldName).
  var foldName = function (s) {
    var out = '';
    Array.from(s).forEach(function (ch) {
      if (STROKE[ch]) { out += STROKE[ch]; return; }
      var cp = ch.codePointAt(0);
      for (var z = 0; z < DIGIT_ZEROS.length; z++) if (cp >= DIGIT_ZEROS[z] && cp <= DIGIT_ZEROS[z] + 9) { out += String.fromCharCode(0x30 + cp - DIGIT_ZEROS[z]); return; }
      if ((cp >= 0xFF21 && cp <= 0xFF3A) || (cp >= 0xFF41 && cp <= 0xFF5A)) { out += String.fromCharCode(cp - 0xFEE0); return; }
      var d = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out += d.length === 1 ? d : ch;
    });
    return out;
  };
  // shape-core nameWords: digits stay inside a word, only whitespace, _ - . / and non-ASCII punctuation separate (the server and the
  // profiler read a name this way; d3.llmValueColumn.nameWords above drops digits, which is the coordinate reader's rule).
  var readWords = function (name) {
    return String(name == null ? '' : name).normalize('NFC')
      .replace(/([\p{Ll}\p{Nd}])(\p{Lu})/gu, '$1 $2').replace(/[_\-.\/]+/g, ' ')
      .replace(/[^\p{L}\p{M}\p{N}\x00-\x7F]/gu, ' ').toLowerCase().split(/\s+/)
      .filter(function (w) { return w.length > 0; });
  };
  var readName = function (name) {
    var s = String(name == null ? '' : name).normalize('NFC');
    var words = readWords(s), folded = readWords(foldName(s));
    return { words: words, folded: folded.length === words.length ? folded : words.map(foldName) };
  };
  var lowerNfc = function (s) { return s.normalize('NFC').toLowerCase(); };
  var alt = function (phrases) {
    return phrases.slice().sort(function (a, b) { return b.length - a.length; })
      .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'); }).join('|');
  };
  var hasCjk = function (t) {
    return Array.from(t).some(function (ch) { var c = ch.codePointAt(0); return (c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af); });
  };
  var PREFIX_RE = new RegExp('^\\s*(?:(?:sum|count|count\\s+distinct|distinct\\s+count)\\s+of\\s+|(?:' + alt(DEFAULT_PREFIXES) + ')\\s+)', 'i');
  var SUFFIX_RE = (function () {
    var latin = DEFAULT_SUFFIXES.filter(function (l) { return !hasCjk(l); }), cjk = DEFAULT_SUFFIXES.filter(hasCjk), parts = [];
    if (latin.length) parts.push('(?:\\s+|\\s*[\u2013\u2014-]\\s*)(' + alt(latin) + ')');
    if (cjk.length) parts.push('\\s*(' + alt(cjk) + ')');
    return new RegExp('(?:' + parts.join('|') + ')\\s*$', 'i');
  })();
  // The name without the host's default aggregation label, English or localized (shape-core stripHostAggPrefix).
  var stripAgg = function (name) {
    var s = String(name == null ? '' : name), folded = foldName(s);
    var m = PREFIX_RE.exec(folded);
    if (m) return s.slice(m[0].length).trim();
    var sm = SUFFIX_RE.exec(folded);
    if (sm && folded.slice(0, sm.index).trim() !== '') return s.slice(0, sm.index).trim();
    return s.trim();
  };
  var endsWithStem = function (word, token, minStem) {
    return !!word && !!token && word.length > token.length && word.endsWith(token) && cpLen(word.slice(0, word.length - token.length)) >= minStem;
  };
  var gluedStems = function (word, lang) {
    var out = [], list = GLUED[lang];
    if (!word || !list) return out;
    list.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (p) {
      if (word.length > p.length && word.startsWith(p)) { var st = word.slice(p.length); if (cpLen(st) >= 2 && out.indexOf(st) < 0) out.push(st); }
    });
    return out;
  };
  var readsAs = function (word, token, lang, first) {
    if (!word) return false;
    if (word === token) return true;
    if (has(NO_BREAKS, lang)) {
      if (cpLen(token) < 2) return false;
      return (first ? word.startsWith(token) : word.endsWith(token)) && word.length > token.length;
    }
    if (first) return gluedStems(word, lang).indexOf(token) >= 0;
    if (lang === 'ko') return /\p{Script=Hangul}/u.test(token) && endsWithStem(word, token, 2);
    if (has(COMPOUNDS, lang)) return endsWithStem(word, token, 3);
    return false;
  };
  // True when the name carries another language's identifier word where that language puts it.
  return function (name) {
    var n = String(name == null ? '' : name).trim();
    if (!n) return false;
    var whole = readName(n), stripped = readName(stripAgg(n));
    for (var lang in WORDS) {
      var first = has(HEAD_INITIAL, lang), reading = first ? stripped : whole;
      for (var t = 0; t < WORDS[lang].length; t++) {
        var token = WORDS[lang][t];
        var plain = has(UNFOLDED, token) || lang === 'vi';
        var words = plain ? reading.words : reading.folded;
        if (words.length === 0) continue;
        var tok = plain ? lowerNfc(token) : readName(token).folded.join(' ');
        if (readsAs(first ? words[0] : words[words.length - 1], tok, lang, first)) return true;
      }
    }
    return false;
  };
})();
// SHARED colour ramp + legend for a map, tile grid or heatmap that shades each region or cell by ONE
// aggregated value (World and USA choropleths, the hex and world tile-grid cartograms, the heatmap lanes).
//
// Contract:
//   const ramp = d3.llmValueRamp({ values: [...], low, high, mid, canvas, highContrast, midColor });
//     values - the aggregates of the regions you DRAW; null / NaN are ignored, never read as 0
//     low, high - the ramp's end colours (the reader's forced Colour scale picker values when set)
//     mid - OPTIONAL centre (1 for 100%, 0 for a signed measure): a DIVERGING ramp, symmetric about mid -
//           the low colour below it, the centre colour at it, the high colour above it. Without low / high
//           a diverging ramp uses a neutral orange / blue pair, never one hue.
//     canvas, highContrast - the background the chart paints on and the high-contrast flag; the centre is
//           a neutral grey just off that canvas (near-white on light, dark grey on dark, 25 L* away in high
//           contrast). Neither given: #f7f7f7. midColor - an explicit centre colour, which wins.
//     key - OPTIONAL: names this ramp's memory under a page filter (onCanvas, below) when one chart draws two ramps
//   ramp.color(v)   -> colour | null (null for a missing value - paint no-data yourself)
//   ramp.onCanvas(options) -> the same ramp drawn on the chart's canvas (options.backgroundColor, else options.themeBg) and
//                     under its high-contrast flag, both read here so the chart never branches on them: one built without a
//                     canvas is rebuilt with it (a sequential ramp on a dark canvas then keeps its ends off the page, below);
//                     one built with a canvas, or a call with none, returns the ramp as it is. A colour may stand for options.
//                     A PAGE FILTER NEVER RE-SPREADS IT: the options' filter (options.filterScope, read through d3.llmFilterScope)
//                     is read here too. A ramp built on every row is remembered; one built while a filter narrows the rows is
//                     rebuilt on the values the full rows gave, so a region keeps its colour whatever the filter leaves, and the
//                     legend's ends stay the full rows' ends. A chart first drawn already filtered has no full rows to keep.
//   ramp.landFill(c) -> the land or no-data fill on this ramp's canvas: on a dark canvas (not high contrast) c walked in
//                     lightness until it holds 3:1 against the page, and with no c a neutral grey at that ratio; on any other
//                     canvas, or with none, c as given, or the light default #e6e6e6
//   ramp.ink(v, a, b) -> of the two inks a and b, the one that stands out more on ramp.color(v) (a when v is
//                      missing) - the text colour for a label drawn ON a shaded region
//   ramp.kind      -> 'linear' | 'bands' | 'constant' | 'diverging'; ramp.skewed === (ramp.kind === 'bands')
//   ramp.lo, ramp.hi, ramp.median, ramp.p95; ramp.mid (null unless diverging)
//   ramp.edges      -> bands: [lo, t1, .., hi]; diverging: [mid - span, mid, mid + span]; otherwise [lo, hi]
//   ramp.colors     -> bands: one colour per band; diverging: [low, midColor, high]; otherwise [low, high]
//   ramp.drawLegend(parent, { x, y, width, height, orient, labelY, fontSize, fg, fgOpacity, format, id,
//                             stroke, constantText, marks, lowLabel, highLabel }) -> { width, height }
//     lowLabel, highLabel - words for the two sides ('below target', 'above target'): a row under the
//     values, each under its own end (beside the bar when vertical), class llm-value-ramp-side; the box
//     returned includes it, so reserve one more label row. A mark AT a diverging ramp's centre is not drawn:
//     the centre line and its value already are that reference.
//     orient - 'horizontal' | 'vertical'. Omitted, a box more than twice as tall as it is wide is VERTICAL:
//     the bar stands upright, high at the top, and every label sits BESIDE it (x = width + 4, start-
//     anchored) - reserve room to the bar's right; labelY is not used, and the box returned includes the
//     labels. Any other box is the horizontal bar below.
//     marks - [{ value, label }]: a reference value ON the ramp (a mean, a target) - a dashed tick
//     across the bar and 'label value' in the label row where it clears the others, else a <title>
//     draws <g class="llm-value-ramp" data-kind> at (x, y): a gradient bar (rect.llm-value-ramp-bar,
//     fill url(#id)) or one rect.llm-value-ramp-band per band, and text.llm-value-ramp-label at
//     labelY (default height + fontSize) - both ends always, each inner band edge only where it
//     clears the labels beside it, and for 'constant' the one value followed by constantText.
//     A diverging legend runs low -> midColor -> high, a thin line.llm-value-ramp-mid marks the centre,
//     and the centre value is printed where it clears the two ends. A vertical one carries data-orient.
//
// WHY IT MEASURES FIRST. A linear ramp is right for spread values and defeats skewed ones: a few
// large regions take the top of the scale and the bulk of the map lands on one pale shade -
// accurate and unreadable. So it reads the median and the 95th percentile and picks:
//   * 'linear' when p95 <= 4 x median, when there are fewer than 10 values, or when any value is
//     negative - exactly the gradient these maps always drew;
//   * 'bands' otherwise: up to five EQUAL-COUNT bands (quintile edges at data values, a repeated edge
//     merged, so no band is empty), each
//     a point on the same low->high ramp, and the legend prints the band edges in the measure's own
//     units so a reader can still read a value off a colour.
// A centre (mid) skips that test: a diverging ramp is read as a side and a distance from the centre.
// @requires llmFilterScope
d3.llmValueRamp = function (cfg) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the legend's labels draw no smaller
  cfg = cfg || {};
  var num = function (v) { return (v == null || v === '' || !isFinite(+v)) ? null : +v; };
  var vals = [];
  (cfg.values || []).forEach(function (v) { v = num(v); if (v != null) vals.push(v); });
  vals.sort(function (a, b) { return a - b; });
  // A CENTRE MAKES IT DIVERGING. Its ends are the caller's forced colours when set, otherwise a neutral
  // orange / blue pair - never the sequential defaults, whose two ends are one hue and cannot show a side.
  var mid = num(cfg.mid), diverging = mid != null;
  var low = cfg.low || (diverging ? '#b35806' : '#eef3f8'), high = cfg.high || (diverging ? '#2166ac' : '#3182bd');
  // ON A DARK CANVAS THE RAMP STAYS OFF THE PAGE. The automatic low end is a tint of the accent taken from the canvas, so on a
  // dark page it is a navy at about 1.2:1 against the page: the smallest regions read as background, and a map of many small ones
  // as one dark mass. With the canvas given (and not in high contrast), a sequential ramp's low end moves along the ramp toward
  // its high end until it holds 3:1 against a dark canvas, and its high end is walked in lightness, hue kept, until it holds twice
  // the low end's ratio, so the ramp still runs from dim to bright. A light canvas, a diverging ramp and high contrast keep their
  // ends exactly as given.
  var cvColor = cfg.canvas ? d3.color(cfg.canvas) : null;
  var lumOf = function (c) {
    var q = d3.rgb(c);
    var f = function (u) { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(q.r) + 0.7152 * f(q.g) + 0.0722 * f(q.b);
  };
  var onPage = function (c) { var a = lumOf(c), b = lumOf(cvColor); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  var darkCanvas = !!(cvColor && !cfg.highContrast && cvColor.opacity >= 1 && lumOf(cvColor) < 0.2);
  var offPage = function (c, floor) {
    var q = d3.lab(c);
    if (!isFinite(q.l)) return c;
    for (var i = 0; i < 60 && q.l < 100 && onPage(q.formatHex()) < floor; i++) q.l = Math.min(100, q.l + 2);
    return q.formatHex();
  };
  if (darkCanvas && !diverging) {
    // The low end moves TOWARD the high end first, so it leaves the page in the ramp's own hue: walked in lightness alone it
    // turned a grey that the land beside it matched.
    var toHigh = d3.interpolateLab(low, high), s = 0;
    while (s < 20 && onPage(d3.lab(toHigh(s / 20)).formatHex()) < 3) s++;
    low = offPage(d3.lab(toHigh(s / 20)).formatHex(), 3);
    high = offPage(high, Math.max(3, onPage(low) * 2));
  }
  // THE CENTRE IS A NEUTRAL JUST OFF THE CANVAS, so every colour reads as a distance from it: a near-white on a light
  // canvas, a dark grey on a dark one, and in high contrast a grey that stands well apart from either. The caller
  // passes its canvas and the high-contrast flag; with neither, the light-canvas centre.
  var midColor = cfg.midColor;
  if (!midColor) {
    var cv = cfg.canvas ? d3.lab(cfg.canvas) : null, cl = cv && isFinite(cv.l) ? cv.l : null;
    if (cl == null && !cfg.highContrast) midColor = '#f7f7f7';
    else {
      if (cl == null) cl = 100;
      var off = cfg.highContrast ? 25 : (cl < 50 ? 18 : 3);
      midColor = d3.lab(cl < 50 ? cl + off : cl - off, 0, 0).formatHex();
    }
  }
  var n = vals.length;
  var lo = n ? vals[0] : 0, hi = n ? vals[n - 1] : 1;
  var median = n ? d3.quantile(vals, 0.5) : null, p95 = n ? d3.quantile(vals, 0.95) : null;
  var scale = d3.scaleLinear().domain(lo === hi ? [lo - 1, hi] : [lo, hi]).range([low, high]).clamp(true);
  var kind = n && lo === hi ? 'constant' : 'linear', edges = [lo, hi], colors = [low, high];
  if (diverging) {
    // SYMMETRIC ABOUT THE CENTRE: a step of colour is the same distance from mid on either side, so the
    // side nearer the centre reads paler instead of being stretched to the full ramp.
    var span = Math.max(Math.abs(lo - mid), Math.abs(hi - mid)) || Math.abs(mid) || 1;
    edges = [mid - span, mid, mid + span];
    colors = [low, midColor, high];
    scale = d3.scaleLinear().domain(edges).range([low, midColor, high]).clamp(true);
    kind = 'diverging';
  } else if (n >= 10 && lo >= 0 && lo !== hi && p95 > 4 * median) {
    // EDGES ARE DATA VALUES, never interpolated between two: an interpolated quintile can land in a
    // gap in the data and leave a band nobody is in. A band [t, next) then always holds t itself.
    var inner = [];
    for (var q = 1; q < 5; q++) {
      var t = vals[Math.floor(q * n / 5)];
      if (t > lo && (!inner.length || t > inner[inner.length - 1])) inner.push(t);
    }
    // Two inner edges at least: one edge is a two-colour map, which says less than the gradient.
    if (inner.length >= 2) {
      var along = d3.scaleLinear().domain([0, inner.length]).range([low, high]);
      colors = [];
      for (var c = 0; c <= inner.length; c++) colors.push(along(c));
      // A BAND IS FOUND BY BISECTING ITS EDGES: a threshold scale's own rule (t <= v < next) written out.
      // This source is prepended to the generated code before the quality checks run, and a named
      // binned-scale call beside the linear branch's gradient legend read to them as a binned scale under
      // a continuous legend, which rejected every chart that used this helper.
      scale = function (v) { return colors[d3.bisectRight(inner, v)]; };
      edges = [lo].concat(inner, [hi]);
      kind = 'bands';
    }
  }
  // A reference mark AT the centre of a diverging ramp is the centre itself.
  var atCentre = function (v) { return kind === 'diverging' && Math.abs(v - mid) <= 1e-9 * Math.max(1, Math.abs(mid)); };

  // THE VERTICAL LEGEND: the same bar stood upright - high at the top, low at the bottom - with every
  // label BESIDE the bar. A horizontal bar prints its two ends in one row under it; on a bar 14 px wide
  // that row is 14 px long, and the two ends printed on top of each other.
  var drawVertical = function (g, w, h, size, fg, op, fmt, o) {
    var fs = Math.max(TYPE_FLOOR, size);   // floored here too: the caller's size arrives as a parameter
    var lx = w + 4, rows = [], widest = 0, k = colors.length;
    var a0 = kind === 'diverging' ? edges[0] : lo, a1 = kind === 'diverging' ? edges[edges.length - 1] : hi;
    var at = function (f) { return h - Math.max(0, Math.min(1, f)) * h; };   // 0 = the low end, 1 = the high end
    var frac = function (v) {
      if (kind === 'bands') {
        var bi = Math.max(0, Math.min(k - 1, d3.bisectRight(edges, v) - 1));
        var sp = edges[bi + 1] - edges[bi];
        return (bi + (sp > 0 ? Math.max(0, Math.min(1, (v - edges[bi]) / sp)) : 0)) / k;
      }
      return a1 > a0 ? (v - a0) / (a1 - a0) : 0.5;
    };
    // A label's box on y is [baseline - 0.8 fs, baseline + 0.2 fs]; one that comes within 4 px of a box
    // already placed is not drawn, unless it is an end.
    var placeY = function (y, text, always, cls) {
      var y0 = y - 0.8 * fs, y1 = y + 0.2 * fs;
      if (!always && rows.some(function (r) { return y0 < r[1] + 4 && y1 > r[0] - 4; })) return false;
      rows.push([y0, y1]);
      g.append('text').attr('class', cls || 'llm-value-ramp-label').attr('x', lx).attr('y', y)
        .attr('text-anchor', 'start').attr('font-size', fs).attr('fill', fg).attr('fill-opacity', op).text(text);
      widest = Math.max(widest, String(text).length * fs * 0.58);
      return true;
    };
    var box = function () {
      var bottom = h;
      rows.forEach(function (r) { bottom = Math.max(bottom, r[1]); });
      return { width: lx + widest, height: bottom };
    };
    if (kind === 'bands') {
      var sh = h / k;
      for (var b = 0; b < k; b++) {
        var r = g.append('rect').attr('class', 'llm-value-ramp-band').attr('y', (k - 1 - b) * sh).attr('width', w)
          .attr('height', sh).attr('fill', colors[b]).attr('data-from', edges[b]).attr('data-to', edges[b + 1]);
        if (o.stroke) r.attr('stroke', o.stroke).attr('stroke-width', 0.5);
      }
    } else {
      var id = o.id || ('llmramp-' + Math.abs((w * 131 + h * 7) | 0) + '-v' + (kind === 'diverging' ? 'd' : ''));
      var lg = g.append('defs').append('linearGradient').attr('id', id)
        .attr('x1', '0%').attr('y1', '100%').attr('x2', '0%').attr('y2', '0%');
      lg.append('stop').attr('offset', '0%').attr('stop-color', low);
      if (kind === 'diverging') lg.append('stop').attr('offset', '50%').attr('stop-color', midColor);
      lg.append('stop').attr('offset', '100%').attr('stop-color', high);
      var bar = g.append('rect').attr('class', 'llm-value-ramp-bar').attr('width', w).attr('height', h)
        .attr('fill', 'url(#' + id + ')');
      if (o.stroke) bar.attr('stroke', o.stroke).attr('stroke-width', 0.5);
    }
    if (kind === 'constant') {
      placeY(Math.min(h, 0.8 * fs), fmt(lo) + (o.constantText || ''), true);
      return box();
    }
    // BOTH ENDS ALWAYS: the high end's label hangs from the bar's top and the low end's sits on its
    // bottom - on a bar shorter than two lines, one line below the high end, so they never overprint.
    var topY = 0.8 * fs, botY = Math.max(h, topY + fs + 4);
    placeY(topY, fmt(a1), true);
    placeY(botY, fmt(a0), true);
    // THE TWO SIDES IN WORDS: each one line past its end's value, beside the bar.
    if (o.highLabel) placeY(topY + fs + 2, o.highLabel, true, 'llm-value-ramp-side');
    if (o.lowLabel) placeY(botY + fs + 2, o.lowLabel, true, 'llm-value-ramp-side');
    if (kind === 'diverging') {
      var cy = at(0.5);
      var cl = g.append('line').attr('class', 'llm-value-ramp-mid').attr('x1', 0).attr('x2', w)
        .attr('y1', cy).attr('y2', cy).attr('stroke', fg).attr('stroke-opacity', 0.6).attr('stroke-width', 1);
      if (!placeY(cy + 0.3 * fs, fmt(mid), false)) cl.append('title').text(fmt(mid));
    }
    (o.marks || []).forEach(function (m) {
      var v = num(m && m.value);
      if (v == null || atCentre(v)) return;
      var y = at(frac(v));
      var text = (m.label != null && m.label !== '' ? m.label + ' ' : '') + fmt(v);
      var tick = g.append('line').attr('class', 'llm-value-ramp-mark').attr('x1', -2).attr('x2', w + 2)
        .attr('y1', y).attr('y2', y).attr('stroke', fg).attr('stroke-width', 1.5).attr('stroke-dasharray', '3,2');
      if (!placeY(y + 0.3 * fs, text, false)) tick.append('title').text(text);
    });
    if (kind === 'bands') for (var e = 1; e < k; e++) placeY(at(e / k) + 0.3 * fs, fmt(edges[e]), false);
    return box();
  };

  var drawLegend = function (parent, o) {
    o = o || {};
    // ORIENTATION. A box more than twice as tall as it is wide is a vertical bar (the heatmap lanes stand a
    // 14 x 180 bar beside the grid). Every horizontal caller passes a height of 8 to 12 px and a width of
    // 40 px or more, so it stays the bar it always was; orient says it outright either way.
    var vertical = o.orient === 'vertical' ||
      (o.orient !== 'horizontal' && +o.width > 0 && +o.height > 2 * +o.width);
    var w = o.width || (vertical ? 12 : 120), h = o.height || (vertical ? 120 : 8), fs = Math.max(TYPE_FLOOR, o.fontSize || TYPE_FLOOR);
    var fg = o.fg || '#333', op = o.fgOpacity == null ? 1 : o.fgOpacity;
    var ly = o.labelY == null ? h + fs : o.labelY;
    var fmt = typeof o.format === 'function' ? o.format : function (v) { return String(v); };
    var g = parent.append('g').attr('class', 'llm-value-ramp').attr('data-kind', kind)
      .attr('transform', 'translate(' + (o.x || 0) + ',' + (o.y || 0) + ')');
    if (vertical) {
      g.attr('data-orient', 'vertical');
      return drawVertical(g, w, h, fs, fg, op, fmt, o);
    }
    var label = function (x, anchor, text) {
      g.append('text').attr('class', 'llm-value-ramp-label').attr('x', x).attr('y', ly)
        .attr('text-anchor', anchor).attr('font-size', fs).attr('fill', fg).attr('fill-opacity', op).text(text);
    };
    // THE LABELS THAT FIT. Both ends always; anything else only where its text clears every label
    // already placed, by the 0.58 x font-size run the other helpers estimate with.
    var taken = [];
    var place = function (x, anchor, text, always) {
      var wd = String(text).length * fs * 0.58;
      var x0 = anchor === 'start' ? x : anchor === 'end' ? x - wd : x - wd / 2;
      if (!always && taken.some(function (s) { return x0 < s[1] + 4 && x0 + wd > s[0] - 4; })) return false;
      taken.push([x0, x0 + wd]);
      label(x, anchor, text);
      return true;
    };
    var k = colors.length, sw = w / k;
    var a0 = kind === 'diverging' ? edges[0] : lo, a1 = kind === 'diverging' ? edges[edges.length - 1] : hi;
    if (kind !== 'bands') {
      var id = o.id || ('llmramp-' + Math.abs((w * 131 + h * 7) | 0) + (kind === 'diverging' ? '-d' : ''));
      var lg = g.append('defs').append('linearGradient').attr('id', id);
      lg.append('stop').attr('offset', '0%').attr('stop-color', low);
      if (kind === 'diverging') lg.append('stop').attr('offset', '50%').attr('stop-color', midColor);
      lg.append('stop').attr('offset', '100%').attr('stop-color', high);
      var bar = g.append('rect').attr('class', 'llm-value-ramp-bar').attr('width', w).attr('height', h)
        .attr('fill', 'url(#' + id + ')');
      if (o.stroke) bar.attr('stroke', o.stroke).attr('stroke-width', 0.5);
      // ONE VALUE IS NOT A RANGE: printing it as lo..hi invites the reader to see variation the
      // ramp cannot be carrying.
      if (kind === 'constant') {
        label(0, 'start', fmt(lo) + (o.constantText || ''));
        return { width: w, height: Math.max(h, ly) };
      }
      place(0, 'start', fmt(a0), true);
      place(w, 'end', fmt(a1), true);
      // THE CENTRE OF A DIVERGING RAMP is what the reader reads every colour against: a thin line across
      // the bar, and its value in the label row where it clears the two ends (a <title> otherwise).
      if (kind === 'diverging') {
        var cl = g.append('line').attr('class', 'llm-value-ramp-mid').attr('x1', w / 2).attr('x2', w / 2)
          .attr('y1', 0).attr('y2', h).attr('stroke', fg).attr('stroke-opacity', 0.6).attr('stroke-width', 1);
        if (!place(w / 2, 'middle', fmt(mid), false)) cl.append('title').text(fmt(mid));
      }
    } else {
      for (var b = 0; b < k; b++) {
        var r = g.append('rect').attr('class', 'llm-value-ramp-band').attr('x', b * sw).attr('width', sw)
          .attr('height', h).attr('fill', colors[b]).attr('data-from', edges[b]).attr('data-to', edges[b + 1]);
        if (o.stroke) r.attr('stroke', o.stroke).attr('stroke-width', 0.5);
      }
      place(0, 'start', fmt(lo), true);
      place(w, 'end', fmt(hi), true);
    }
    // A REFERENCE VALUE ON THE RAMP (a mean, a target): a dashed tick across the bar where the value
    // sits, and its label in the label row - placed before the inner band edges, and when it would
    // collide the tick carries it as a <title> instead. Never stacked above the bar: that line is the
    // channel name's, and a mean hand-placed there printed through it.
    (o.marks || []).forEach(function (m) {
      var v = num(m && m.value);
      if (v == null || atCentre(v)) return;
      var x;
      if (kind === 'bands') {
        var bi = Math.max(0, Math.min(k - 1, d3.bisectRight(edges, v) - 1));
        var span = edges[bi + 1] - edges[bi];
        x = (bi + (span > 0 ? Math.max(0, Math.min(1, (v - edges[bi]) / span)) : 0)) * sw;
      } else {
        x = Math.max(0, Math.min(w, (v - a0) / (a1 - a0) * w));
      }
      var text = (m.label != null && m.label !== '' ? m.label + ' ' : '') + fmt(v);
      var tick = g.append('line').attr('class', 'llm-value-ramp-mark').attr('x1', x).attr('x2', x)
        .attr('y1', -2).attr('y2', h + 2).attr('stroke', fg).attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '3,2');
      if (!place(x, 'middle', text, false)) tick.append('title').text(text);
    });
    if (kind === 'bands') for (var e = 1; e < k; e++) place(e * sw, 'middle', fmt(edges[e]), false);
    // THE TWO SIDES IN WORDS (lowLabel / highLabel): the numbers say how far, not which way is good. One
    // row under the values - the low side's word under the low end, the high side's under the high end;
    // on a bar too short for both, the high word follows the low one instead of printing over it.
    var bottom = ly;
    if (o.lowLabel || o.highLabel) {
      var sy = ly + fs + 2, lwd = o.lowLabel ? String(o.lowLabel).length * fs * 0.58 : 0;
      var hwd = o.highLabel ? String(o.highLabel).length * fs * 0.58 : 0;
      var side = function (x, anchor, text) {
        g.append('text').attr('class', 'llm-value-ramp-side').attr('x', x).attr('y', sy)
          .attr('text-anchor', anchor).attr('font-size', fs).attr('fill', fg).attr('fill-opacity', op).text(text);
      };
      if (o.lowLabel) side(0, 'start', o.lowLabel);
      if (o.highLabel) { if (lwd + hwd + 8 > w) side(lwd ? lwd + 8 : 0, 'start', o.highLabel); else side(w, 'end', o.highLabel); }
      bottom = sy;
    }
    return { width: w, height: Math.max(h, bottom) };
  };

  // INK ON A FILL: of two inks, the one that stands out more on the colour this value paints. A diverging
  // ramp's centre sits near the canvas, so the ink its strong ends need vanishes on the centre.
  var colorOf = function (v) { v = num(v); return v == null ? null : scale(v); };
  var relLum = function (c) {
    var q = c ? d3.color(c) : null;
    if (!q) return null;
    q = q.rgb();
    var f = function (u) { u /= 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    var L = 0.2126 * f(q.r) + 0.7152 * f(q.g) + 0.0722 * f(q.b);
    return isFinite(L) ? L : null;
  };
  var ink = function (v, a, b) {
    var lf = relLum(colorOf(v)), la = relLum(a), lb = relLum(b);
    if (lf == null || la == null || lb == null) return a;
    var ratio = function (x, y) { return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    return ratio(lf, la) >= ratio(lf, lb) ? a : b;
  };

  var self = {
    color: colorOf, ink: ink,
    kind: kind, skewed: kind === 'bands', lo: lo, hi: hi, median: median, p95: p95, mid: diverging ? mid : null,
    edges: edges, colors: colors, drawLegend: drawLegend,
    // THE LAND AND NO-DATA FILLS, ON THE SAME CANVAS. A map's default land is a light grey: on a dark page a glaring near-white
    // world, while a land laid just off a dark canvas sinks into it. On a dark canvas both hold 3:1 against the page.
    landFill: function (c) {
      if (!darkCanvas) return c || '#e6e6e6';
      return offPage(c || d3.lab(d3.lab(cvColor).l, 0, 0).formatHex(), 3);
    },
    onCanvas: function (o) {
      var canvas = o, hc = false, next = null;
      if (o && typeof o === 'object') {
        canvas = o.backgroundColor && o.backgroundColor !== 'transparent' ? o.backgroundColor : o.themeBg;
        hc = !!o.isHighContrast;
        var scope = d3.llmFilterScope(o);
        var kept = scope.domain('llmValueRamp:' + (cfg.key == null ? '' : String(cfg.key)), cfg.values || []);
        if (scope.narrowed && kept.cohort === 'all') next = { values: kept.values };
      }
      if (canvas && !cfg.canvas) next = Object.assign(next || {}, { canvas: canvas, highContrast: hc });
      return next ? d3.llmValueRamp(Object.assign({}, cfg, next)) : self;
    },
  };
  return self;
};
// SHARED label-fit helper for hand-drawn D3 charts that place text INSIDE a mark
// (treemap tiles, icicle bands, funnel stages, stacked-bar segments).
//
// Why this exists: codegen reliably gates a label on the MARK's size and then truncates
// by CHARACTER COUNT, which is a proxy for width that fails exactly where it matters. A
// 40px tile passes a ">= 36px" gate, "Los Angeles" is under a 14-char cap so it is left
// whole, and at 10px it renders ~72px wide - centred, so it spills into the tiles on BOTH
// sides. Measured: 34 of 35 prod treemap/icicle gens that draw text never
// measure it.
//
// Contract: call AFTER .text(...) and after font-size is set, with an accessor for the
// space available to that datum. Truncates to the widest prefix that actually fits, and
// blanks the label outright when even one character + the ellipsis will not.
//
// opts.text (string or accessor) - THE AUTHORITATIVE LABEL FOR THIS CALL, and REQUIRED on any
// chart whose text CHANGES between calls. By default the helper caches the original string so a
// re-fit (resize, proofread re-render) works from the full text instead of eroding an already
// clipped one; that is right for a resize and wrong for an animation tick, where a value line is
// a different string every frame. Without opts.text an animated label would be restored to
// frame 0's string and held there - a stale number wearing the look of a label bug.
//
// A STRING IN, THE FITTED STRING OUT: d3.llmFitLabel('Customer effort score', 180, 11) or
// d3.llmFitLabel(name, 180, { fontSize: 11 }) returns the string cut to fit 180px at 11px, for a
// chart that builds its label text before it appends the node. It is the idiom a generation reached
// for, and the selection-only helper handed the string back untouched: six KPI names ran off a
// Bullet chart's frame with no fit at all. Measured on a hidden text node at that font size (the
// estimate where there is no DOM); opts.fontFamily / opts.fontWeight name the chart's font. The
// returned string is only ever CUT, never shrunk - the caller owns its font size - so shrinkTo does
// not apply here.
d3.llmFitLabel = function (sel, widthAccessor, opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: a string is fitted at no smaller size than a chart may draw it
  // AN OBJECT IN THE ROOM'S PLACE. d3.llmFitLabel(sel, { text: name, width: w, pad: 2 }) - the room named
  // INSIDE the options - is read as d3.llmFitLabel(sel, w, { text: name, pad: 2 }). The helper used to take that object
  // as the room itself: +{} is NaN, so it blanked EVERY label it was handed (a legend of five swatches and no
  // names). opts.room is read when width is absent, and a third argument's keys win over the object's; a number as the
  // third argument is still the string form's font size. An object that names no width finds no room and blanks, as before.
  if (widthAccessor != null && typeof widthAccessor === 'object' && !Array.isArray(widthAccessor)) {
    var wobj = widthAccessor, wopts = {};
    for (var wk in wobj) if (Object.prototype.hasOwnProperty.call(wobj, wk) && wk !== 'width' && wk !== 'room') wopts[wk] = wobj[wk];
    if (opts != null && typeof opts === 'object') {
      for (var wk2 in opts) if (Object.prototype.hasOwnProperty.call(opts, wk2)) wopts[wk2] = opts[wk2];
    } else if (typeof opts === 'number' && opts > 0 && wopts.fontSize == null) {
      wopts.fontSize = Math.max(TYPE_FLOOR, opts);
    }
    widthAccessor = wobj.width != null ? wobj.width : wobj.room;
    opts = wopts;
  }
  if (typeof sel === 'string' || typeof sel === 'number') {
    var so = (opts != null && typeof opts === 'object') ? opts
      : ((arguments[3] != null && typeof arguments[3] === 'object') ? arguments[3] : {});
    var sfs = Math.max(TYPE_FLOOR, (typeof opts === 'number' && opts > 0) ? opts : (+so.fontSize > 0 ? +so.fontSize : TYPE_FLOOR));
    var sopts = {};
    for (var sk in so) if (Object.prototype.hasOwnProperty.call(so, sk)) sopts[sk] = so[sk];
    sopts.text = String(sel);
    sopts.shrinkTo = null;
    var holder = null, sn = null;
    try {
      if (typeof document !== 'undefined' && document && document.body && document.createElementNS) {
        holder = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        holder.setAttribute('width', '0'); holder.setAttribute('height', '0');
        holder.style.position = 'absolute'; holder.style.left = '-10000px'; holder.style.visibility = 'hidden';
        sn = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        holder.appendChild(sn);
        document.body.appendChild(holder);
      }
    } catch (e) { holder = null; sn = null; }
    if (!sn) {
      sn = { textContent: '', style: {}, fs: sfs,
             getAttribute: function (a) { return a === 'font-size' ? String(sn.fs) : null; },
             setAttribute: function (a, v) { if (a === 'font-size') sn.fs = +v; } };
    }
    var fitted;
    try {
      sn.setAttribute('font-size', String(sfs));
      if (so.fontFamily) sn.setAttribute('font-family', String(so.fontFamily));
      if (so.fontWeight) sn.setAttribute('font-weight', String(so.fontWeight));
      d3.llmFitLabel({ each: function (fn) { fn.call(sn, null, 0); return this; } }, widthAccessor, sopts);
      fitted = sn.textContent == null ? '' : String(sn.textContent);
    } catch (e) { fitted = String(sel); }
    try { if (holder && holder.parentNode) holder.parentNode.removeChild(holder); } catch (e) { /* detached */ }
    return fitted;
  }
  opts = opts || {};
  var pad = opts.pad == null ? 4 : opts.pad;
  var minWidth = opts.minWidth == null ? 14 : opts.minWidth;
  var ell = opts.ellipsis == null ? '\u2026' : opts.ellipsis;
  var fallbackFs = opts.fontSize == null ? 10 : opts.fontSize;
  // SHRINK BEFORE YOU CUT (opts.shrinkTo, a font size in px). A label that is WIDER than its room
  // is not always a label that should be cut: '180,000 of 200,000' truncated to '180,000 of 2...'
  // is a different number, and a ring's hole is a circle whose chord at the label's baseline is
  // most of what it has. When shrinkTo is given, the helper first reduces the node's font-size
  // from its current value toward shrinkTo until the FULL text fits, and only if it still does
  // not fit at the floor falls through to the cut. The original size is remembered so a re-fit
  // on a wider tile grows the label back rather than leaving it small.
  // opts.overflow: 'truncate' (default, the behaviour every existing caller has) or 'drop' -
  // blank the label rather than cut it, for text whose truncation would state something false.
  var shrinkTo = opts.shrinkTo == null ? null : +opts.shrinkTo;
  var overflow = opts.overflow === 'drop' ? 'drop' : 'truncate';
  // A LABEL FALLS THROUGH ITS SHORTER TRUE FORMS BEFORE IT IS CUT (opts.forms: an array, or an accessor (d, i) that
  // returns one, longest first). A tile's sub-line 'Goal $1.2M - Attainment 95%' cut to 'Goal $1.2M - Attai...' on a
  // phone loses the half the tile is for, while '95% of goal' fits whole. When the label does not fit, each form is
  // tried WHOLE, in order, and the first that fits is drawn; with shrinkTo, the shrink is then tried on the label and
  // each form in the same order; only when none of them fits is the SHORTEST form cut (or blanked, with overflow
  // 'drop'). A form is a whole phrase that is still true, never the label with words chopped off. An array as
  // opts.text is the same thing: its first entry is the label, the rest its forms. The caller keeps the full label
  // in a <title> or tooltip, as for a cut.
  // A CUT KEEPS WHAT TELLS THE LABEL APART (opts.distinctFrom, the sibling labels). The widest
  // prefix is the right cut for one label and the wrong one for a set that shares its start: sixteen gauge
  // panels named 'SBA NAME 1' to 'SBA NAME 18' were each cut to 'SBA NA...', so no panel could be matched to
  // its name. Given the labels drawn beside this one, a prefix cut that keeps no more than this label shares
  // with a sibling becomes a TAIL cut - the ellipsis, then the widest ending that fits ('...NAME 12') - never
  // splitting a number, and blank when even the tail will not fit. A label no sibling shares a start with is
  // cut as before. Callers rarely pass it, and need not: see SIBLINGS ARE THE LABELS ALREADY FITTED below.
  var sibs = Array.isArray(opts.distinctFrom) ? opts.distinctFrom : null;

  if (!sel || typeof sel.each !== 'function') return sel;

  // A CUT NEVER LANDS INSIDE A NUMBER. The widest prefix that fits is right for a word and wrong for a
  // number: 'largest 12...' of 'largest 128 of 400' and '1,234,5...' of '1,234,567' read as different
  // values, and the ellipsis does not say which digits went. So a cut that would split a number - between
  // two digits, at a group or decimal separator between digits, or before a unit or percent sign glued to
  // the digits - moves back to before that number and its sign or currency symbol; a label that is only
  // the number is blanked, as overflow 'drop' would. Every caller gets this, model-written code included,
  // so a caption built from a raw count ('largest ' + n) can no longer state a different count.
  var DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\u09E6-\u09EF\uFF10-\uFF19]/;
  var JOIN = /[.,'\u00A0\u202F\u2019\u066B\u066C]/;
  var GLUED = /[A-Za-z%\u2030]/;
  var LEAD = /[+\-\u2212$\u20AC\u00A3\u00A5\u20B9]/;
  function numberSafeCut(s, lo) {
    if (!(lo > 0) || lo >= s.length) return lo;
    var a = s.charAt(lo - 1), b = s.charAt(lo);
    var splits = DIGIT.test(a)
      ? (DIGIT.test(b) || GLUED.test(b) || (JOIN.test(b) && DIGIT.test(s.charAt(lo + 1))))
      : (lo >= 2 && JOIN.test(a) && DIGIT.test(s.charAt(lo - 2)) && DIGIT.test(b));
    if (!splits) return lo;
    var i = lo;
    while (i > 0 && (DIGIT.test(s.charAt(i - 1))
                     || (i >= 2 && JOIN.test(s.charAt(i - 1)) && DIGIT.test(s.charAt(i - 2))))) i--;
    while (i > 0 && LEAD.test(s.charAt(i - 1))) i--;
    while (i > 0 && /\s/.test(s.charAt(i - 1))) i--;
    return i;
  }

  function fontSizeOf(node) {
    try {
      var a = parseFloat(node.getAttribute && node.getAttribute('font-size'));
      if (a > 0) return a;
      var s = node.style && node.style.fontSize ? parseFloat(node.style.fontSize) : NaN;
      if (s > 0) return s;
    } catch (e) { /* fall through */ }
    return fallbackFs;
  }

  function setFontSize(node, fs) {
    try { if (node.setAttribute) node.setAttribute('font-size', String(fs)); } catch (e) { /* detached */ }
  }

  // Real metrics in a browser; a conservative estimate anywhere that lacks SVG text
  // measurement (the jsdom exec-gate sidecar has no getComputedTextLength, and a
  // detached node can legitimately report 0) - never throw, never assume it fits.
  function measure(node, txt) {
    try {
      if (typeof node.getComputedTextLength === 'function') {
        var w = node.getComputedTextLength();
        if (w > 0) return w;
      }
    } catch (e) { /* fall through */ }
    return String(txt).length * fontSizeOf(node) * 0.6;
  }

  // SIBLINGS ARE THE LABELS ALREADY FITTED IN THE SAME <svg>. The widest prefix is the right cut for one label
  // and the wrong one for a set whose names share a start: thirty treemap codes on a small tile were cut to
  // 'RSB 40...', 'RSB 40...', 'FS...', 'FS...', so a label pointed at the wrong tile or at none. The callers fit
  // one tile at a time and do not pass distinctFrom, so the helper keeps its own list on the owning svg node,
  // __llmFitRegistry ({ node, full, visible, room }). When a fitted label reads the same as another label in that
  // svg whose full text differs, BOTH are re-fitted to a distinguishing ending: the head that fits, the ellipsis,
  // and the shortest ending of the full text that no colliding label ends with - started at a word where that
  // fits, never inside a number. A label that cannot fit one is blanked (its <title> or tooltip still names it).
  // A label nothing else reads the same as is untouched; opts.distinctFrom still shapes this label's own cut first.
  function ownerSvg(node) {
    try {
      if (node.ownerSVGElement) return node.ownerSVGElement;
      for (var p = node.parentNode; p; p = p.parentNode) {
        if (p.nodeName && String(p.nodeName).toLowerCase() === 'svg') return p;
      }
    } catch (e) { /* detached */ }
    return null;
  }
  // What a reader sees: a <title> child is the tooltip, not the label.
  function shownText(node) {
    var kids = node && node.childNodes;
    if (!kids || !kids.length) return node.textContent == null ? '' : String(node.textContent);
    var s = '';
    for (var c = 0; c < kids.length; c++) {
      var k = kids[c];
      if (k.nodeType === 3) s += k.nodeValue;
      else if (k.nodeType === 1 && String(k.nodeName).toLowerCase() !== 'title') s += shownText(k);
    }
    return s;
  }
  // A label fitted EARLIER and re-fitted now keeps the <title> its caller appended after that first fit.
  function setShown(node, s) {
    var kids = node.childNodes, keep = [];
    if (kids && kids.length) {
      for (var c = 0; c < kids.length; c++) {
        if (kids[c].nodeType === 1 && String(kids[c].nodeName).toLowerCase() === 'title') keep.push(kids[c]);
      }
    }
    node.textContent = s;
    for (var q = 0; q < keep.length; q++) node.appendChild(keep[q]);
  }
  function hiddenIn(node, svg) {
    try {
      for (var p = node, hop = 0; p && hop < 64; p = p.parentNode, hop++) {
        if (p.getAttribute && (p.getAttribute('display') === 'none' || p.getAttribute('visibility') === 'hidden')) return true;
        if (p.style && (p.style.display === 'none' || p.style.visibility === 'hidden')) return true;
        if (p === svg) break;
      }
    } catch (e) { /* read as shown */ }
    return false;
  }
  // An entry is stale once its node left the svg, or its caller re-texted it without a re-fit.
  // The string a label was fitted FROM: the label itself, or the shorter form drawn in its place.
  function fittedFrom(node) {
    return node.__llmFitFrom != null ? node.__llmFitFrom : node.__llmFullLabel;
  }
  function live(svg, en) {
    if (shownText(en.node) !== en.visible) return false;
    if (fittedFrom(en.node) != null && String(fittedFrom(en.node)) !== en.full) return false;
    try { if (typeof svg.contains === 'function' && !svg.contains(en.node)) return false; } catch (e) { /* keep */ }
    return true;
  }
  function endsWithText(s, t) { return s.length >= t.length && s.slice(s.length - t.length) === t; }
  function ending(en, others) {
    var f = en.full, n = en.node, E = en.ell;
    if (en.drop) return '';
    var fits = function (s) { setShown(n, s); return measure(n, s) <= en.room; };
    // The shortest ending no colliding label ends with.
    var t = -1;
    for (var s = f.length - 1; s >= 1 && t < 0; s--) {
      var tl = f.slice(s), alone = true;
      for (var o = 0; o < others.length && alone; o++) if (endsWithText(others[o], tl)) alone = false;
      if (alone) t = s;
    }
    if (t < 1) return '';
    // Never inside a number: '...8' of 'NAME 18' is another name, so back to the number's first digit.
    if (DIGIT.test(f.charAt(t)) && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) {
      while (t > 0 && (DIGIT.test(f.charAt(t - 1)) || (t >= 2 && JOIN.test(f.charAt(t - 1)) && DIGIT.test(f.charAt(t - 2))))) t--;
    }
    if (t < 1) return '';
    // Prefer the start of the word that ending sits in, when that still fits.
    var ws = t;
    while (ws > 0 && !/\s/.test(f.charAt(ws - 1))) ws--;
    if (ws > 0 && ws < t && fits(E + f.slice(ws))) t = ws;
    else if (!fits(E + f.slice(t))) return '';
    // Then the widest head that fits in front of it, cut by the same number rule.
    var tail = f.slice(t), lo = 0, hi = t - 1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (fits(f.slice(0, mid) + E + tail)) lo = mid; else hi = mid - 1;
    }
    var head = f.slice(0, numberSafeCut(f, lo)).replace(/\s+$/, '');
    if (head.length < 2) head = '';
    return head + E + tail;
  }
  function distinguish(group) {
    var g, h, s, en, others;
    for (g = 0; g < group.length; g++) {
      en = group[g];
      others = [];
      for (h = 0; h < group.length; h++) if (group[h].full !== en.full) others.push(group[h].full);
      try { s = ending(en, others); } catch (e) { s = ''; }
      setShown(en.node, s);
      en.visible = shownText(en.node);
    }
    // Two different names that still read alike both go.
    for (g = 0; g < group.length; g++) {
      for (h = g + 1; h < group.length; h++) {
        var a = group[g], b = group[h];
        if (a.visible && a.visible === b.visible && a.full !== b.full) {
          setShown(a.node, ''); a.visible = '';
          setShown(b.node, ''); b.visible = '';
        }
      }
    }
  }
  function clashes(reg, svg, en) {
    var group = [en], differ = false;
    if (hiddenIn(en.node, svg)) return group;
    for (var k = reg.length - 1; k >= 0; k--) {
      var o = reg[k];
      if (o === en || o.visible !== en.visible) continue;
      if (!live(svg, o)) { reg.splice(k, 1); continue; }
      if (hiddenIn(o.node, svg)) continue;
      group.push(o);
      if (o.full !== en.full) differ = true;
    }
    return differ ? group : [en];
  }
  function settle(node, room) {
    var svg = ownerSvg(node);
    if (!svg) return;
    var reg = svg.__llmFitRegistry;
    if (!Array.isArray(reg)) { reg = []; svg.__llmFitRegistry = reg; }
    var k;
    for (k = reg.length - 1; k >= 0; k--) if (reg[k].node === node) reg.splice(k, 1);
    // A long-lived svg whose labels are re-joined every frame would grow the list without end: sweep it now and then.
    if (reg.length >= (reg.sweepAt || 256)) {
      for (k = reg.length - 1; k >= 0; k--) if (!live(svg, reg[k])) reg.splice(k, 1);
      reg.sweepAt = Math.max(256, reg.length * 2);
    }
    var vis = shownText(node);
    if (!(room > 0) || !vis) return;
    var me = { node: node, full: fittedFrom(node) == null ? vis : String(fittedFrom(node)),
               visible: vis, room: room, ell: ell, drop: overflow === 'drop' };
    reg.push(me);
    var queue = [me];
    for (var round = 0; queue.length && round < 32; round++) {
      var en = queue.shift();
      if (!en.visible) continue;
      var group = clashes(reg, svg, en);
      if (group.length < 2) continue;
      distinguish(group);
      for (var g = 0; g < group.length; g++) if (group[g].visible) queue.push(group[g]);
    }
  }

  // One label's fit; returns the room it was fitted to (undefined when the label was empty).
  function fitOne(node, d, i) {
    // Re-runnable: keep the ORIGINAL text so a second pass (proofread re-render, resize) re-fits
    // from the full string instead of eroding an already-clipped one. An animated chart supplies
    // opts.text instead, because its label is a NEW string each frame rather than the same one
    // re-measured - see the header.
    var full, alts = [];
    if (opts.text != null) {
      try {
        full = typeof opts.text === 'function' ? opts.text.call(node, d, i) : opts.text;
      } catch (e) { full = ''; }
      if (Array.isArray(full)) { alts = full.slice(1); full = full[0]; }
      full = full == null ? '' : String(full);
      node.__llmFullLabel = full;
      node.textContent = full;              // authoritative: an EMPTY label must CLEAR the node,
      if (!full) return;                    // never leave the previous frame's text standing
    } else {
      full = node.__llmFullLabel;
      if (full == null) {
        full = node.textContent == null ? '' : String(node.textContent);
        node.__llmFullLabel = full;
      }
      if (!full) return;
    }
    node.__llmFitFrom = null;
    var fo = opts.forms;
    if (typeof fo === 'function') { try { fo = fo.call(node, d, i); } catch (e) { fo = null; } }
    if (fo != null) alts = alts.concat(Array.isArray(fo) ? fo : [fo]);
    var cands = [full];
    for (var ci = 0; ci < alts.length; ci++) {
      var alt = alts[ci] == null ? '' : String(alts[ci]);
      if (alt && cands.indexOf(alt) < 0) cands.push(alt);
    }

    var room;
    try {
      room = typeof widthAccessor === 'function'
        ? widthAccessor.call(node, d, i)
        : widthAccessor;
    } catch (e) { room = 0; }
    room = (room == null ? 0 : +room) - pad * 2;

    if (!(room > 0) || room < minWidth) { node.textContent = ''; return room; }

    // Start every fit from the ORIGINAL size, for the same reason the original TEXT is kept:
    // a re-fit must be able to undo a shrink, not only deepen one.
    if (shrinkTo != null) {
      if (node.__llmFullFontSize == null) node.__llmFullFontSize = fontSizeOf(node);
      setFontSize(node, node.__llmFullFontSize);
    }
    node.textContent = full;
    var w = measure(node, full);
    if (w <= room) return room;                                // fits whole - done

    // A shorter true form, whole, at the label's own size.
    var c;
    for (c = 1; c < cands.length; c++) {
      node.textContent = cands[c];
      if (measure(node, cands[c]) <= room) { node.__llmFitFrom = cands[c]; return room; }
    }

    if (shrinkTo != null && shrinkTo > 0) {
      for (c = 0; c < cands.length; c++) {
        setFontSize(node, node.__llmFullFontSize);
        node.textContent = cands[c];
        var cur = fontSizeOf(node), wc = measure(node, cands[c]);
        if (!(cur > shrinkTo)) break;
        // Width is close to linear in font size, so the first guess lands within a step of
        // the answer; walk down in half-pixels from there and stop at the first size that
        // fits, never below the floor.
        var fs = Math.max(shrinkTo, Math.floor((cur * room / wc) * 2) / 2);
        for (; fs >= shrinkTo; fs -= 0.5) {
          setFontSize(node, fs);
          if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
        }
        setFontSize(node, shrinkTo);
        if (measure(node, cands[c]) <= room) { if (c) node.__llmFitFrom = cands[c]; return room; }
      }
    }
    // Nothing fits whole: the SHORTEST form is the one cut (the label itself when there are no forms).
    if (cands.length > 1) { full = cands[cands.length - 1]; node.__llmFitFrom = full; }
    node.textContent = full;
    if (overflow === 'drop') { node.textContent = ''; return room; }

    // Widest prefix that fits, ellipsis included. Binary search: measure() can be a real
    // layout read, so keep it to ~log2(n) calls per label rather than one per character.
    var lo = 0, hi = full.length;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      node.textContent = full.slice(0, mid) + ell;
      if (measure(node, node.textContent) <= room) lo = mid; else hi = mid - 1;
    }
    lo = numberSafeCut(full, lo);
    // THE TAIL CUT, when the prefix would keep nothing a sibling does not also start with (opts.distinctFrom).
    if (sibs) {
      var shared = 0;
      for (var si = 0; si < sibs.length; si++) {
        var o = sibs[si] == null ? '' : String(sibs[si]);
        if (o === full) continue;
        var k = 0;
        while (k < o.length && k < full.length && o.charAt(k) === full.charAt(k)) k++;
        if (k > shared) shared = k;
      }
      if (shared > 0 && lo <= shared) {
        // The earliest start whose ending fits, ellipsis included - the same binary search, from the other end.
        var a = 1, b = full.length;
        while (a < b) {
          var m = (a + b) >> 1;
          node.textContent = ell + full.slice(m);
          if (measure(node, node.textContent) <= room) b = m; else a = m + 1;
        }
        // AN ENDING NEVER STARTS INSIDE A NUMBER: '...8' of 'NAME 18' is another name. Back to the number's first
        // digit when that still fits; otherwise the label goes, and the caller's <title> or tooltip keeps it.
        var inNum = function (i) {
          return i > 0 && i < full.length && DIGIT.test(full.charAt(i))
            && (DIGIT.test(full.charAt(i - 1)) || (i >= 2 && JOIN.test(full.charAt(i - 1)) && DIGIT.test(full.charAt(i - 2))));
        };
        if (inNum(a)) {
          var t0 = a;
          while (t0 > 0 && (DIGIT.test(full.charAt(t0 - 1)) || (t0 >= 2 && JOIN.test(full.charAt(t0 - 1)) && DIGIT.test(full.charAt(t0 - 2))))) t0--;
          node.textContent = ell + full.slice(t0);
          a = measure(node, node.textContent) <= room ? t0 : full.length;
        }
        node.textContent = a < full.length ? ell + full.slice(a) : '';
        return room;
      }
    }
    node.textContent = lo > 0 ? full.slice(0, lo) + ell : '';
    return room;
  }

  sel.each(function (d, i) {
    var room = fitOne(this, d, i);
    try { settle(this, room); } catch (e) { /* a failed sibling check leaves the fit as it stands */ }
  });

  return sel;
};
// SHARED zoom/pan helper for D3 charts drawn on a map projection (the geo BUBBLE lanes).
//
// Why this exists: zoom is easy to get wrong in ways that only show up in a HOST. Four
// traps, all handled here so 80 generations do not each rediscover them.
//
//  1. THE WHEEL BELONGS TO THE PAGE. A visual sits inside a scrollable report, so a map
//     that swallows the wheel steals the user's scroll. Embedded maps solved this long ago
//     with cooperative gestures (embedded Google Maps, Mapbox cooperativeGestures): Ctrl or
//     Cmd + wheel zooms, a plain wheel scrolls the page, and a one-line hint appears so the
//     plain wheel does not read as a broken map. One finger scrolls the page; two fingers
//     work the map.
//  2. A PAN MUST NOT CROSS-FILTER. The host resolves clicks with a delegated listener on
//     the container root, so the click synthesised at the end of a drag would select
//     whatever mark sat under the pointer. d3-zoom suppresses that click itself, and
//     clickDistance keeps a few px of wobble a real CLICK so ordinary selection still works.
//  3. FURNITURE MUST NOT MOVE. The legend panel, the annotation stack and the reset control
//     live OUTSIDE the transformed layer, and the layer is clipped to the map area, so
//     nothing can pan out over the panel or the notes.
//  4. SYMBOL SIZE IS NOT GEOGRAPHY. A bubble radius encodes a MEASURE, so it must not grow
//     with the zoom the way a country outline does. The chart gets an onZoom callback and
//     counter-scales its own marks and labels by the transform's k.
//
// Contract: call BEFORE drawing the map, draw into the returned `layer` - or into z.group(),
// a group in that layer whose borders and hub dots keep their on-screen size as the map grows
// (a choropleth's whole zoom wiring is these two calls) - and append the legend/notes to the
// SVG afterwards so they paint on top. Never null for a real svg: when d3.zoom is absent (or
// the frame has no size) it returns a STILL object whose layer is the svg itself and whose
// group() appends to it, so the caller draws exactly as it would with no zoom at all.
//   var z = d3.llmGeoZoom(svg, { width, height, originX, originY, themeFg, backgroundColor, fontSize, maxScale });
//   var gMap = z.group({ stroke: 0.5, dotStroke: 0.7 });   // stroke: path border px; dotStroke: hub dots too
d3.llmGeoZoom = function (svg, opts) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: the hint and the pad glyphs draw no smaller
  opts = opts || {};
  if (!svg || typeof svg.append !== 'function') return null;
  // NO ZOOM AVAILABLE: a still map, drawn straight onto the svg - never null, so a caller
  // never needs a guard of its own (a guard is how generations learned to drop zoom).
  var still = function () {
    return { layer: svg, still: true, group: function () { return svg.append('g'); },
      reset: function () {}, step: function () {} };
  };
  if (typeof d3.zoom !== 'function' || typeof d3.zoomIdentity === 'undefined') return still();

  var w = +opts.width, h = +opts.height;
  // ORIGIN of the map area within the SVG. Lanes whose furniture sits to the SIDE
  // (the bubble maps) leave this at 0,0 and nothing changes. A lane whose legend takes a
  // band or a column (the choropleths, placed by d3.llmLegendLayout) passes the map area's
  // own corner, so the pan catcher, the clip and the d-pad all land inside the map rather
  // than across the legend. NOT
  // applied to `layer`: callers project into absolute SVG coords, and translating the
  // layer would slide every mark off its own projection.
  var ox = +opts.originX || 0, oy = +opts.originY || 0;
  if (!(w > 0) || !(h > 0)) return still();
  var maxScale = +opts.maxScale > 1 ? +opts.maxScale : 8;
  var fg = opts.themeFg || '#333';
  var fs = Math.max(TYPE_FLOOR, +opts.fontSize > 0 ? +opts.fontSize : 11);
  var coop = opts.cooperative === false ? false : true;
  var onZoom = typeof opts.onZoom === 'function' ? opts.onZoom : null;
  var hintText = opts.hintText || 'Use Ctrl (Cmd) + scroll to zoom, or drag to pan';

  // Clip id derived from the viewport - the geo lanes' convention: deterministic, no
  // random, and two visuals that collide are by definition the same size.
  var clipId = 'llmzoomclip-' + Math.abs(((w * 131 + h * 17 + ox * 7 + oy) | 0));
  svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h);

  var viewport = svg.append('g').attr('clip-path', 'url(#' + clipId + ')');
  // A PAINTED catcher so empty ocean can start a pan. fill 'transparent', never 'none' -
  // an unpainted shape takes no pointer events. It sits UNDER the map content, so marks
  // keep their own clicks.
  viewport.append('rect').attr('class', 'llm-zoom-surface')
    .attr('x', ox).attr('y', oy).attr('width', w).attr('height', h)
    .attr('fill', 'transparent');
  var layer = viewport.append('g');

  // MAP GROUPS (z.group). A BORDER is not geography - it is a hairline drawn on it - and a
  // hub dot marks a place, not an area, so both keep their on-screen size as the map grows:
  // on every zoom, each group's path borders are set to stroke / k and, with dotStroke, its
  // circles to their own radius / k and dotStroke / k. Re-selected on every zoom rather than
  // captured once, so a lane that re-joins its paths per keyframe stays correct.
  var groups = [];
  function group(gopts) {
    var g = layer.append('g');
    groups.push({ g: g, o: gopts || {} });
    return g;
  }
  function scaleGroups(k) {
    if (!(k > 0)) return;
    for (var gi = 0; gi < groups.length; gi++) {
      var ge = groups[gi], go = ge.o;
      try {
        if (+go.stroke > 0) ge.g.selectAll('path').attr('stroke-width', +go.stroke / k);
        if (+go.dotStroke > 0) ge.g.selectAll('circle').each(dotScaler(+go.dotStroke, k));
      } catch (e) { /* a border width is never worth breaking the chart for */ }
    }
  }
  // A hub dot's own radius is read once, the first time it is scaled, so a radius the chart
  // set (the user's Map Dot Size) is what stays constant on screen.
  function dotScaler(dotStroke, k) {
    return function () {
      if (this.__llmBaseR == null) this.__llmBaseR = parseFloat(this.getAttribute('r'));
      if (isFinite(this.__llmBaseR)) this.setAttribute('r', this.__llmBaseR / k);
      this.setAttribute('stroke-width', dotStroke / k);
    };
  }

  // Reset is the pad's CENTRE cell (built below); this holds it so the show/hide and the
  // adopt()-skip keep working. Null on a viewport too small for the pad, hence every use
  // being guarded.
  var ctrl = null;

  // SIX ALWAYS-VISIBLE CONTROLS. Cooperative gestures are the right
  // BEHAVIOUR but they are INVISIBLE: nothing on the chart said the map could move at all,
  // and a reader on a trackpad, a touchpad or a wheel-less mouse had no way to find out.
  // Zoom in/out plus pan left/up/right/down, laid out as a d-pad so each direction reads
  // without a label:
  //     [+] [^] [-]
  //     [<]     [>]
  //         [v]
  // On the SVG ROOT like the rest of the furniture, so the transform never moves them, and
  // OUTSIDE the zoom viewport so a press is a click rather than the start of a pan.
  var PAD_BTN = Math.max(15, Math.min(22, Math.round(fs * 1.7)));
  var PAD_GAP = 2, PAD_W = PAD_BTN * 3 + PAD_GAP * 2;
  var padX = ox + w - PAD_W - 6, padY = oy + 6;
  var pad = null, panBtns = [];
  // Omit rather than overlap: on a tile too small to hold the pad and still be a map, the
  // gesture path is still there and the furniture rule wins (same test the size key uses).
  if (w >= PAD_W + fs * 8 && h >= PAD_BTN * 3 + PAD_GAP * 2 + 16) {
    pad = svg.append('g').attr('class', 'llm-zoom-pad');
    // The centre cell was empty and Reset was a separate box in the opposite corner, so the
    // controls read as two unrelated things. Reset now sits in the middle of its own d-pad
    // - one compact cluster, and the arrows point away from the thing that
    // undoes them.
    var CELLS = [
      [0, 0, 'in', '+'], [1, 0, 'up', '\u2191'], [2, 0, 'out', '\u2212'],
      [0, 1, 'left', '\u2190'], [1, 1, 'reset', '\u27F2'], [2, 1, 'right', '\u2192'],
      [1, 2, 'down', '\u2193']
    ];
    // A named function, not an IIFE: injected helpers are prepended into generated code
    // and face the same CQC pass it does, and d3_iife_wrapper rejects the (function(){})()
    // form. Passing the cell as an argument gives the same per-iteration capture.
    for (var ci = 0; ci < CELLS.length; ci++) addPadButton(CELLS[ci]);
  }
  function addPadButton(cell) {
    {
        var bx = padX + cell[0] * (PAD_BTN + PAD_GAP);
        var by = padY + cell[1] * (PAD_BTN + PAD_GAP);
        // a pad button is a control the keyboard reaches
        var g = pad.append('g').attr('class', 'llm-zoom-btn lch-control').style('cursor', 'pointer')
          .attr('aria-label', { 'in': 'Zoom in', out: 'Zoom out', reset: 'Reset the view', up: 'Pan up', down: 'Pan down', left: 'Pan left', right: 'Pan right' }[cell[2]] || String(cell[2]));
        g.append('rect').attr('x', bx).attr('y', by).attr('rx', 3)
          .attr('width', PAD_BTN).attr('height', PAD_BTN)
          .attr('fill', opts.backgroundColor || '#fff').attr('fill-opacity', 0.85)
          .attr('stroke', fg).attr('stroke-opacity', 0.35);
        g.append('text').attr('x', bx + PAD_BTN / 2).attr('y', by + PAD_BTN / 2)
          .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
          .attr('font-size', Math.max(TYPE_FLOOR, PAD_BTN - 6)).attr('fill', fg)
          .style('pointer-events', 'none').text(cell[3]);
        g.on('click', function (event) {
          if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          llmZoomStep(cell[2]);
        });
        // The arrows do nothing at k=1 (translateExtent pins the fitted frame), so they
        // start dimmed - a control that looks live and is not is worse than none.
        if (cell[2] === 'reset') { ctrl = g; g.style('opacity', 0.35); panBtns.push(g); }
        else if (cell[2] !== 'in' && cell[2] !== 'out') { g.style('opacity', 0.35); panBtns.push(g); }
    }
  }

  var hint = svg.append('g').style('display', 'none').style('pointer-events', 'none');
  hint.append('rect').attr('x', ox + w / 2 - fs * 12).attr('y', oy + h / 2 - fs).attr('rx', 4)
    .attr('width', fs * 24).attr('height', fs * 2)
    .attr('fill', fg).attr('fill-opacity', 0.72);
  hint.append('text').attr('x', ox + w / 2).attr('y', oy + h / 2 + fs * 0.4)
    .attr('text-anchor', 'middle').attr('font-size', fs)
    .attr('fill', opts.backgroundColor || '#fff').text(hintText);

  var hintTimer = null;
  function showHint() {
    try {
      hint.raise().style('display', null).style('opacity', 1);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(function () { hint.style('display', 'none'); }, 1500);
    } catch (e) { /* a hint is never worth breaking the chart for */ }
  }

  // COOPERATIVE GESTURE FILTER. Returning false leaves the event unprevented, which is what
  // lets the report page scroll normally.
  function filt(event) {
    if (!event) return false;
    if (event.type === 'wheel') {
      if (!coop || event.ctrlKey || event.metaKey) return true;
      showHint();
      return false;
    }
    if (event.touches) {
      if (!coop) return true;
      if (event.touches.length < 2) { showHint(); return false; }
      return true;
    }
    if (event.type === 'dblclick') return true;
    return !event.button;                       // primary-button drag pans
  }

  // SELF-HEALING ADOPTION - the "wired it, but it does not work" case. A generation can
  // call this helper and then draw the map straight onto the SVG anyway, which leaves the
  // layer empty and makes the zoom a silent no-op. So on the FIRST gesture, if the layer is
  // still empty, adopt the groups that actually hold the map: anything carrying a .d3-mark
  // or a basemap <path>, minus legend furniture, which must never move with the map. Same
  // doctrine as the exec gate healing a throw rather than failing the render.
  //
  // On first interaction rather than a timer: synchronous, nothing to schedule, and the
  // render is guaranteed complete because nobody can gesture at a chart that does not exist.
  var adopted = false, adoptedBaseR = null;
  function adopt() {
    if (adopted) return;
    adopted = true;
    try {
      var layerNode = layer.node(), svgNode = svg.node();
      if (!layerNode || !svgNode) return;
      if (layerNode.childNodes.length) return;          // drawn correctly - nothing to do
      var kids = [].slice.call(svgNode.childNodes), moved = 0;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType !== 1 || !n.querySelector) continue;
        if (n === viewport.node() || n === hint.node()) continue;
        if (ctrl && n === ctrl.node()) continue;
        if (pad && n === pad.node()) continue;
        if (n.tagName === 'defs' || n.tagName === 'title') continue;
        // Furniture stays put, even when it happens to contain a path.
        var isFurniture = (n.classList && n.classList.contains('d3-legend-mark'))
          || n.querySelector('.d3-legend-mark');
        if (isFurniture) continue;
        var holdsMap = n.tagName === 'path'
          || (n.classList && n.classList.contains('d3-mark'))
          || n.querySelector('.d3-mark')
          || (n.tagName === 'g' && n.querySelector('path'));
        if (!holdsMap) continue;
        layerNode.appendChild(n);                        // document order is preserved
        moved++;
      }
      if (!moved) return;
      // The chart's own onZoom cannot be counter-scaling marks it never put here, so the
      // helper takes that over: a radius encodes a MEASURE, not an area on the ground.
      adoptedBaseR = [];
      var ms = layerNode.querySelectorAll('.d3-mark');
      for (var j = 0; j < ms.length; j++) {
        var r = parseFloat(ms[j].getAttribute('r'));
        if (isFinite(r)) adoptedBaseR.push([ms[j], r, parseFloat(ms[j].getAttribute('stroke-width')) || 0]);
      }
    } catch (e) { /* a heal is never worth breaking the chart for */ }
  }

  // Base font sizes, captured lazily the first time we compensate - reading them every
  // frame would re-read a value we had already divided.
  var textBase = null;
  function scaleLayerText(k) {
    if (!(k > 0)) return;
    try {
      var layerNode = layer.node();
      if (!layerNode) return;
      var ts = layerNode.querySelectorAll('text');
      if (textBase === null || textBase.length !== ts.length) {
        textBase = [];
        for (var i = 0; i < ts.length; i++) {
          var cs = null;
          try { cs = window.getComputedStyle(ts[i]).fontSize; } catch (e) { cs = null; }
          var px = parseFloat(ts[i].getAttribute('font-size'));
          if (!isFinite(px)) px = parseFloat(cs);
          textBase.push(isFinite(px) && px > 0 ? px : 0);
        }
      }
      for (var j = 0; j < ts.length; j++) {
        if (textBase[j] > 0) ts[j].setAttribute('font-size', (textBase[j] / k).toFixed(2));
      }
    } catch (e) { /* a label size is never worth breaking the chart for */ }
  }

  function scaleAdopted(k) {
    if (!adoptedBaseR || !(k > 0)) return;
    for (var i = 0; i < adoptedBaseR.length; i++) {
      var e = adoptedBaseR[i];
      e[0].setAttribute('r', e[1] / k);
      if (e[2]) e[0].setAttribute('stroke-width', e[2] / k);
    }
  }

  var zoom = d3.zoom()
    // d3's DEFAULT wheelDelta multiplies by 10 when ctrlKey is set, because it assumes
    // ctrl+wheel means a trackpad PINCH. Here ctrl is the deliberate zoom modifier, so that
    // boost makes a single notch slam to the maximum scale. Use the plain delta.
    .wheelDelta(function (event) {
      return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
    })
    .scaleExtent([1, maxScale])
    .extent([[0, 0], [w, h]])
    // Keep the fitted world inside the frame: at k=1 there is nothing to pan to, which is
    // also what keeps the map from drifting off its own reserved area.
    .translateExtent([[0, 0], [w, h]])
    .clickDistance(4)
    .filter(filt)
    .on('zoom', function (event) {
      var t = event && event.transform ? event.transform : d3.zoomIdentity;
      adopt();                       // no-op when the chart drew into the layer as intended
      layer.attr('transform', t.toString());
      scaleAdopted(t.k);
      scaleLayerText(t.k);
      scaleGroups(t.k);
      if (onZoom) { try { onZoom(t); } catch (e) { /* never break the render */ } }
      try {
        // The pad is always visible; only the arrows and Reset go live once there is
        // something to pan or undo. Hiding the whole cluster is what made zoom
        // undiscoverable in the first place.
        if (ctrl) ctrl.style('opacity', t.k > 1.001 ? 1 : 0.35);
        for (var pi = 0; pi < panBtns.length; pi++) panBtns[pi].style('opacity', t.k > 1.001 ? 1 : 0.35);
        if (pad) pad.raise();
      } catch (e) { /* ignore */ }
    });

  try { viewport.call(zoom); } catch (e) { if (pad) pad.remove(); return { layer: layer, group: group, reset: function () {}, step: function () {} }; }

  function reset() {
    try { viewport.call(zoom.transform, d3.zoomIdentity); } catch (e) { /* ignore */ }
  }

  // Pan by a FRACTION OF THE FRAME so a press feels the same on any tile size, divided by
  // k because translateBy works in the layer's own pre-scale coordinates - without that,
  // one press at k=8 would jump eight times as far as the same press at k=1. translateExtent
  // already clamps at the edges, so a press at the border is a no-op, never a drift off the
  // reserved map area. An arrow moves the VIEW that way, so the content moves the opposite
  // way - the same direction sense as a scrollbar or an arrow key.
  function llmZoomStep(dir) {
    try {
      if (dir === 'reset') { reset(); return; }
      if (dir === 'in') { viewport.call(zoom.scaleBy, 1.6); return; }
      if (dir === 'out') { viewport.call(zoom.scaleBy, 1 / 1.6); return; }
      var t = d3.zoomTransform(viewport.node());
      var k = t && t.k > 0 ? t.k : 1;
      var dx = (w * 0.18) / k, dy = (h * 0.18) / k;
      if (dir === 'left') viewport.call(zoom.translateBy, dx, 0);
      else if (dir === 'right') viewport.call(zoom.translateBy, -dx, 0);
      else if (dir === 'up') viewport.call(zoom.translateBy, 0, dy);
      else if (dir === 'down') viewport.call(zoom.translateBy, 0, -dy);
    } catch (e) { /* a control is never worth breaking the chart for */ }
  }

  return { layer: layer, group: group, reset: reset, zoom: zoom, viewport: viewport, pad: pad, step: llmZoomStep };
};
// THE WORD FOR WHAT A MAP'S ROWS ARE. A map's caption counts its rows - "40 countries in 7 of 9 cells", "3 states
// outside the frame" - and the word must be the rows' own grain. The Bivariate World Choropleth's key said "40 regions" over
// 40 countries. The grain is in the join column the host builds, __geoIso__: an ISO-3 code is a country, a two-letter USPS code
// is a US state, a digit code is a ZIP or county area, anything else (an ISO 3166-2 subdivision, a name) is a region.
//
// CONTRACT
//   const P = d3.llmPlaceUnit(data);   // data = { columns, rows } as render() receives it
//   P.one, P.many      'country' / 'countries', 'state' / 'states', 'area' / 'areas' or 'region' / 'regions'
//   P.count(n)         '1 country', '40 countries' - the number as given, then the word that agrees with it
//   The grain is read from the majority of the non-blank __geoIso__ values; with none (no join column, nothing matched) the
//   word is 'region'. Never throws.
d3.llmPlaceUnit = function (data) {
  var WORDS = { country: ['country', 'countries'], state: ['state', 'states'], area: ['area', 'areas'], region: ['region', 'regions'] };
  var votes = { country: 0, state: 0, area: 0, region: 0 };
  try {
    var cols = data && data.columns ? data.columns : [];
    var at = -1;
    for (var c = 0; c < cols.length; c++) if (cols[c] && cols[c].name === '__geoIso__') { at = c; break; }
    var rows = at >= 0 && data.rows ? data.rows : [];
    for (var r = 0; r < rows.length; r++) {
      var v = rows[r] ? rows[r][at] : null;
      if (v === null || v === undefined || v === '') continue;
      var s = String(v).trim();
      if (/^[A-Z]{3}$/.test(s)) votes.country++;
      else if (/^[A-Z]{2}$/.test(s)) votes.state++;
      else if (/^[0-9]{3,5}$/.test(s)) votes.area++;
      else votes.region++;
    }
  } catch (e) { /* an unreadable table counts nothing: the word below is 'region' */ }
  var best = 'region', most = 0;
  ['country', 'state', 'area', 'region'].forEach(function (k) { if (votes[k] > most) { most = votes[k]; best = k; } });
  var w = WORDS[best];
  return {
    one: w[0],
    many: w[1],
    count: function (n) { return n + ' ' + (+n === 1 ? w[0] : w[1]); }
  };
};
// SHARED world-basemap FIT for D3 maps drawn on a WORLD projection: the route lane, the world
// point lanes and the world choropleths.
//
// What it owns, so a caller cannot get it half-right:
//   * the FAR-SOUTH TRIM. The far south is about a third of a Natural Earth frame for a
//     continent that is almost never a business dimension, so the basemap is cut just under
//     the trimmed continent's own top edge, leaving a thin SLIVER so the map never reads as
//     though the continent were missing;
//   * ANY point below FAR_SOUTH, or any data REGION reaching below it, turns the trim off
//     completely - pass every place a mark sits (BOTH ends of a route) and every region that
//     carries data, because a supply line to a research station is exactly the dataset that
//     must see its own continent;
//   * the TWO-PASS FIT. Fitting the full world and then cropping leaves the cropped height as
//     dead space under the map; fitting a TRIMMED world instead scales as though the continent
//     did not exist, so its landing position stops being determined by the fit. So the full
//     world is fitted twice - the first pass only MEASURES what the clip will remove;
//   * the clip goes on the BASEMAP GROUP ONLY, never on point or route marks: clipping a mark
//     hides data, not scenery, and the trim is already off whenever a mark sits below the cut.
//     A choropleth's regions ARE its basemap, so it clips its region group with wf.clip.
// With no basemap it fits the points' own extent and trims nothing.
//
//   var wf = d3.llmWorldFit(proj, {
//     geo: geo,                  // options.geo FeatureCollection, or null
//     points: epts,              // [[lon, lat], ...] - EVERY place a mark sits (point and route maps)
//     regions: matched,          // the basemap features that CARRY DATA (choropleths)
//     width: mapW, height: mapH, // the MAP AREA: the clip's width, and the y the clip never passes
//     pad: pad,                  // inset of the fit box, px
//     viewport: [W, H] });       // the whole chart: sizes the sliver and names the clip
//   Optional, for a lane whose frame is not simply the map area inset by pad:
//     box: [[x0, y0], [x1, y1]]  // the fit box (y1 is where the map bottom lands before the trim)
//     pointBox: [[..], [..]]     // the fit box when there is NO basemap (default: box)
//     fitPolygons: true          // fit the basemap's polygons only (its Point features are join aids)
//     refit: false               // one fit, no second pass
//     anchorLow: y               // a width-bound map moves DOWN so most slack sits above it, under y
//     clipTop: y                 // the clip's top edge (default 0)
//   var path = wf.path;          // d3.geoPath over the fitted projection - draw basemap AND marks with it
//   wf.basemap(svg, layer)       // the clipped <g class='llm-basemap'> to draw countries into; null with no geo
//   wf.basemap(svg, layer, true) // the same clipped group, plain: no class, pointer events untouched
//   wf.clip(svg, g)              // clip a group you made yourself (a choropleth's region group); returns g
//   wf.trimSouth / wf.clipBottom // whether the far south is trimmed, and the y the basemap is cut at
d3.llmWorldFit = function (proj, opts) {
  opts = opts || {};
  var FAR_SOUTH = -60;
  var geo = (opts.geo && opts.geo.features && opts.geo.features.length) ? opts.geo : null;
  var mapW = +opts.width || 0, mapH = +opts.height || 0;
  var pad = isFinite(+opts.pad) && opts.pad !== null && opts.pad !== undefined ? +opts.pad : 8;
  var vp = opts.viewport || [mapW, mapH];
  var VW = +vp[0] || mapW, VH = +vp[1] || mapH;
  var pts = (opts.points || []).filter(function (p) {
    return p && p.length > 1 && p[0] !== null && p[1] !== null && isFinite(+p[0]) && isFinite(+p[1]);
  });

  var isFarSouth = function (f) { var b = d3.geoBounds(f); return b[1][1] < FAR_SOUTH; };
  var anyFarSouth = pts.some(function (p) { return +p[1] < FAR_SOUTH; })
    || (opts.regions || []).some(function (f) { return !!f && isFarSouth(f); });
  var trimSouth = !!geo && !anyFarSouth;
  // Anchored to min(W, H) of the WHOLE chart: in a portrait viewport width binds the fit, and a
  // height-relative sliver would cover most of the (now small) far south instead of trimming it.
  var sliver = trimSouth ? Math.max(8, Math.round(Math.min(VW, VH) * 0.03)) : 0;

  var box = opts.box || [[pad, pad], [mapW - pad, mapH - pad]];
  var x0 = box[0][0], y0 = box[0][1], x1 = box[1][0], y1 = box[1][1];
  var polys = geo ? geo.features.filter(function (f) { return f.geometry && f.geometry.type !== 'Point'; }) : [];
  var fitGeo = (geo && opts.fitPolygons && polys.length) ? { type: 'FeatureCollection', features: polys } : geo;
  var fitTo = function (bottom) {
    if (geo) proj.fitExtent([[x0, y0], [x1, bottom]], fitGeo);
    else if (pts.length) proj.fitExtent(opts.pointBox || [[x0, y0], [x1, bottom]], { type: 'MultiPoint', coordinates: pts });
  };
  fitTo(y1);
  var path = d3.geoPath(proj);

  var farSouthCol = { type: 'FeatureCollection', features: polys.filter(isFarSouth) };
  if (opts.refit !== false && trimSouth && farSouthCol.features.length) {
    var fsB = path.bounds(farSouthCol), worldB = path.bounds(geo);
    var cut = fsB[0][1] + sliver;                  // where the clip will land
    var crop = Math.max(0, worldB[1][1] - cut);    // dead space this would leave
    if (crop > 1) { fitTo(y1 + crop); path = d3.geoPath(proj); }
  }
  // ANCHOR LOW: when the frame is flatter than the world, fitExtent centres the leftover slack
  // half above and half below, and the bottom half reads as a too-large gutter. Keep about 30% of
  // the slack at the bottom (floor 24px, room for note lines) and shift the rest to the top. The
  // shift is measured from where the CLIP lands, so a height-bound frame does not move.
  var aTop = opts.anchorLow;
  if (trimSouth && aTop !== undefined && aTop !== null && isFinite(+aTop)) {
    var vis = polys.filter(function (f) { return !isFarSouth(f); });
    if (vis.length) {
      var vb = path.bounds({ type: 'FeatureCollection', features: vis });
      var cutA = farSouthCol.features.length ? path.bounds(farSouthCol)[0][1] + sliver : vb[1][1];
      var slackTop = Math.max(0, vb[0][1] - aTop);
      var slackBottom = Math.max(0, y1 - cutA);
      var bottomGap = Math.max(24, Math.round((slackTop + slackBottom) * 0.3));
      var dy = Math.round((mapH - bottomGap) - cutA);
      if (dy > 1) {
        var t = proj.translate();
        proj.translate([t[0], t[1] + Math.min(dy, slackTop + slackBottom)]);
        path = d3.geoPath(proj);
      }
    }
  }
  // The sliver hangs off the TRIMMED CONTINENT'S own top edge, not off where the rest of the
  // world ends: there is open ocean between Cape Horn and the Antarctic coast.
  var farSouthTop = farSouthCol.features.length ? path.bounds(farSouthCol)[0][1] : Infinity;
  var clipBottom = (trimSouth && isFinite(farSouthTop)) ? Math.min(mapH, farSouthTop + sliver) : mapH;
  var clipTop = +opts.clipTop || 0;

  // The clip id is derived from the viewport: deterministic, and two visuals that collide are
  // by definition the same size.
  var clipId = 'llmgeoclip-' + Math.abs((VW * 131 + VH) | 0);
  var defineClip = function (svg) {
    svg.append('defs').append('clipPath').attr('id', clipId).append('rect')
      .attr('x', 0).attr('y', clipTop).attr('width', mapW).attr('height', Math.max(1, clipBottom - clipTop));
  };
  var basemap = function (svg, layer, plain) {
    if (!geo || !svg || !layer) return null;
    defineClip(svg);
    var g = layer.append('g');
    if (plain) return g.attr('clip-path', 'url(#' + clipId + ')');
    return g.attr('class', 'llm-basemap').attr('clip-path', 'url(#' + clipId + ')')
      .style('pointer-events', 'none');
  };
  var clip = function (svg, g) {
    if (!geo || !svg || !g) return g;
    defineClip(svg);
    return g.attr('clip-path', 'url(#' + clipId + ')');
  };

  return { path: path, projection: proj, trimSouth: trimSouth, clipBottom: clipBottom, clipTop: clipTop,
    sliver: sliver, farSouth: FAR_SOUTH, basemap: basemap, clip: clip };
};
// SHARED tooltip helper for hand-drawn D3 charts. Owns POSITIONING and the container
// CHROME (background/border/padding - one run drew a bare-text tooltip
// floating transparent over the bars); you supply the content and decide when to show
// it. The chrome is DEFAULTS on the reused node - restyle via tip.node if a chart
// genuinely needs its own look.
//
// Why this exists: codegen places its tooltip at the cursor (left = clientX + 12) and stops
// there. That is correct until the cursor is near the right or bottom edge, where the tooltip
// runs outside the visual and the host clips it - the reader loses exactly the datum they
// reached for. Measured across the 60 most recent OK generations per environment:
// of the gens that position an HTML tooltip, 8 of 10 in PROD had no clamp or flip at all
// (eight generations over six chart types, tables and flows among them). The same chart
// type did it correctly in one generation and not the next, so this is variance, not
// incapacity - which is why it belongs in a helper rather than in one more sentence of prose.
//
// Contract:
//   var tip = d3.llmTooltip(container);        // container = the element you were handed
//   tip.show('<b>Label</b><br/>42', event);    // HTML string or plain text
//   tip.move(event);                           // on mousemove
//   tip.hide();                                // on mouseout
//   tip.html('<b>Label</b>') / tip.text('42')  // set the content WITHOUT showing (see below)
// The node is pointer-events:none and lives inside the container, so it cannot steal a click
// from a d3-mark and it cannot escape the visual. Safe to call repeatedly - one node per
// container is created and reused.
//
// THE ONE CASE CLAMPING CANNOT FIX: a container SHORTER than the tooltip. On a banner tile
// (1390x29 observed) the box does not fit at any offset, so the flip-and-clamp above only
// chooses which end gets sliced. Where the host offers a tooltip surface of its own - painted
// OUTSIDE the visual, which is the only place with room - the helper hands the content over and
// draws nothing. Hosts without one are unaffected: the lookup finds no bridge and the local
// tooltip is drawn exactly as before.
d3.llmTooltip = function (container, opts) {
  opts = opts || {};
  var gap = opts.gap == null ? 12 : opts.gap;    // distance from the cursor
  var edge = opts.edge == null ? 4 : opts.edge;  // minimum distance from the container edge
  var routed = false;                            // true while the HOST is showing our content
  var lastContent = '';                          // what to re-send if the host is driving
  var lastEv = null;                             // where the cursor last was, for a re-fit

  var host = (container && typeof container.node === 'function') ? container.node() : container;
  var noop = { show: function () { return this; }, move: function () { return this; }, hide: function () { return this; },
               html: function () { return this; }, text: function () { return this; }, node: null };
  if (!host || !host.appendChild) return noop;

  // An <svg> cannot host an HTML child; mount on its parent instead.
  var mount = host;
  if (mount.tagName && String(mount.tagName).toLowerCase() === 'svg' && mount.parentNode) {
    mount = mount.parentNode;
  }
  if (!mount || !mount.appendChild) return noop;

  // Absolute placement is measured from the nearest positioned ancestor, so the mount must be
  // one. Only promote a STATIC element - never clobber a layout the chart chose deliberately.
  try {
    var pos = (typeof getComputedStyle === 'function') ? getComputedStyle(mount).position : '';
    if (!pos || pos === 'static') mount.style.position = 'relative';
  } catch (e) { /* jsdom / exec-gate: no layout engine, positioning is inert anyway */ }

  var tip = mount.__llmTip;
  if (!tip || tip.parentNode !== mount) {
    tip = document.createElement('div');
    tip.className = 'llm-tooltip';
    tip.style.position = 'absolute';
    // PARK IT AT THE ORIGIN. An absolutely-positioned element with left/top unset resolves to its STATIC position - directly below the SVG - and visibility:hidden still OCCUPIES SPACE. So the resting node quietly added its own padding+border to the container scrollHeight on every chart that builds a tooltip. Invisible while the host clipped overflow; the day the host began MEASURING overflow it became a scrollbar on charts that fit perfectly (18px of phantom content on a 620px chart). place() overwrites both on first show, so this costs nothing.
    tip.style.left = '0px';
    tip.style.top = '0px';
    tip.style.pointerEvents = 'none';
    tip.style.visibility = 'hidden';
    tip.style.zIndex = '20';
    tip.style.boxSizing = 'border-box';
    tip.style.whiteSpace = opts.wrap ? 'normal' : 'nowrap';
    // Container chrome. SOLID background on purpose (the Plotly hoverlabel-alpha lesson:
    // a translucent tooltip over dense marks is unreadable exactly where it is needed).
    // Light panel + dark text reads on any chart theme because it is a floating surface,
    // not part of the canvas.
    tip.style.background = 'rgba(255,255,255,0.97)';
    tip.style.border = '1px solid rgba(0,0,0,0.28)';
    tip.style.borderRadius = '4px';
    tip.style.padding = '6px 9px';
    tip.style.boxShadow = '0 2px 6px rgba(0,0,0,0.22)';
    tip.style.color = '#222';
    tip.style.fontSize = '12px';
    mount.appendChild(tip);
    mount.__llmTip = tip;
  }

  // The host's tooltip surface, if this container sits inside one that offers it. Looked up on
  // the CONTAINER CHAIN rather than on window, so two charts sharing a frame can never pick up
  // each other's bridge. Resolved per call: a host may install it after the chart is built.
  function hostTip() {
    try {
      var n = mount, guard = 0;
      while (n && guard++ < 8) {
        if (n.__lchHostTip && typeof n.__lchHostTip.show === 'function') return n.__lchHostTip;
        n = n.parentNode;
      }
    } catch (e) { /* detached node / cross-document parent */ }
    return null;
  }

  function metrics() {
    var w = 0, h = 0, cw = 0, ch = 0;
    try {
      var r = mount.getBoundingClientRect();
      cw = r.width; ch = r.height;
    } catch (e) { /* fall through to the client* fallbacks */ }
    if (!cw) cw = mount.clientWidth || 0;
    if (!ch) ch = mount.clientHeight || 0;
    w = tip.offsetWidth || 0;
    h = tip.offsetHeight || 0;
    return { w: w, h: h, cw: cw, ch: ch };
  }

  // Cursor position in MOUNT coordinates. offsetX/offsetY are relative to the event target
  // (a mark, not the container), so they are the wrong basis - convert from client coords.
  function local(ev) {
    var x = 0, y = 0;
    try {
      var r = mount.getBoundingClientRect();
      if (ev && ev.clientX != null) { x = ev.clientX - r.left; y = ev.clientY - r.top; }
    } catch (e) {
      if (ev && ev.clientX != null) { x = ev.clientX; y = ev.clientY; }
    }
    return { x: x, y: y };
  }

  function place(ev) {
    var m = metrics();
    if (!m.cw || !m.ch) return;              // no layout to clamp against (exec gate)
    var p = local(ev);

    // Prefer below-right of the cursor; FLIP to the other side when that would overflow, then
    // CLAMP so a tooltip wider or taller than the container still starts inside it.
    var left = p.x + gap;
    if (left + m.w > m.cw - edge) left = p.x - gap - m.w;
    if (left < edge) left = edge;
    if (left + m.w > m.cw - edge) left = Math.max(edge, m.cw - m.w - edge);

    var top = p.y + gap;
    if (top + m.h > m.ch - edge) top = p.y - gap - m.h;
    if (top < edge) top = edge;
    if (top + m.h > m.ch - edge) top = Math.max(edge, m.ch - m.h - edge);

    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
  }

  // EITHER ARGUMENT ORDER. The contract is show(content, event); called as show(event, content)
  // the box read "[object MouseEvent]" parked in the corner, and that call has been seen in an
  // archetype, in a served sample and in a few percent of generations. An Event is unmistakable
  // (a clientX, a type, a target) and a content never looks like one, so the helper swaps the
  // two rather than print the event. An ARRAY of lines is a content too - one line per entry.
  function looksLikeEvent(x) {
    return !!x && typeof x === 'object' && !Array.isArray(x)
      && (typeof x.clientX === 'number' || typeof x.type === 'string' || ('target' in x));
  }

  // THE ONE PLACE CONTENT IS WRITTEN, so show(content), html() and text() can never disagree about
  // what the host is re-sent. asText writes textContent whatever the string holds, as a d3
  // selection's .text() does.
  function setContent(content, asText) {
    if (Array.isArray(content)) content = content.map(function (x) { return x == null ? '' : String(x); }).join(asText ? ' ' : '<br/>');
    lastContent = content == null ? '' : String(content);
    if (!asText && typeof content === 'string' && content.indexOf('<') >= 0) tip.innerHTML = lastContent;
    else tip.textContent = lastContent;
  }

  // CONTENT WITHOUT A SHOW: tip.html(content) and tip.text(content). A d3 selection is driven that
  // way, so codegen writes it - tip.show(); tip.move(event); tip.html('...') - and on a handle with
  // only show/move/hide every hover threw after show() had made the EMPTY box visible. The content
  // is set exactly as show(content) sets it. A tooltip already on screen is re-fitted to the new
  // content where it stands (the host's surface gets the new content; ours is re-measured and
  // re-placed at the last cursor position); a hidden one STAYS hidden - showing is show()'s job.
  // With no argument each reads the content back, as a d3 selection's getter does.
  function setAndRefit(self, content, asText) {
    setContent(content, asText);
    if (routed) {
      var hbSet = hostTip();
      if (hbSet && hbSet.show(lastContent, lastEv) === true) return self;
      routed = false;                          // the host let go: the tooltip is still on screen, so draw ours
      return self.show(null, lastEv);
    }
    if (tip.style.visibility === 'visible') return self.show(null, lastEv);
    return self;
  }

  return {
    node: tip,
    html: function (content) { return arguments.length ? setAndRefit(this, content, false) : lastContent; },
    text: function (content) { return arguments.length ? setAndRefit(this, content, true) : (tip.textContent || ''); },
    show: function (content, ev) {
      if (looksLikeEvent(content) && !looksLikeEvent(ev)) { var swapped = content; content = ev; ev = swapped; }
      if (ev) lastEv = ev;
      if (content != null) setContent(content, false);
      // Measure the NATURAL box FIRST. "Does it fit?" is a question about the container, not
      // about the clamp we are deciding whether to apply - measured after clamping, everything
      // always fits and the question can never be answered.
      tip.style.maxWidth = 'none';
      tip.style.visibility = 'visible';      // measurable BEFORE placing
      var m = metrics();
      if (m.ch && m.h + (2 * edge) > m.ch) {
        var hbShow = hostTip();
        // The host may decline - the reader switched tooltips off, or it is already showing its
        // own from the row data. Then we draw ours: clipped still beats absent.
        if (hbShow && hbShow.show(lastContent, ev) === true) {
          routed = true;
          tip.style.visibility = 'hidden';
          return this;
        }
      }
      routed = false;
      // A tooltip can never be wider than the space it must fit in.
      if (m.cw) tip.style.maxWidth = Math.max(80, m.cw - (2 * edge)) + 'px';
      place(ev);
      return this;
    },
    move: function (ev) {
      if (ev) lastEv = ev;
      if (routed) { var hbMove = hostTip(); if (hbMove) hbMove.move(ev); return this; }
      if (tip.style.visibility === 'visible') place(ev);
      return this;
    },
    hide: function () {
      if (routed) { var hbHide = hostTip(); if (hbHide) hbHide.hide(); routed = false; }
      tip.style.visibility = 'hidden';
      return this;
    }
  };
};
// SHARED legend PLACEMENT for a map that gives part of its frame to a legend: a BAND across the
// frame (above the map, or below it) or a COLUMN beside it - whichever leaves the larger map. The
// World and USA choropleths, single-measure and bivariate, place their legend through it.
//
// WHY THE PLACEMENT IS CHOSEN, NOT FIXED. A band costs the map its HEIGHT and a column costs it
// WIDTH, and a map is bound by only one of the two. On a wide, short tile a full-width band takes
// height from a map that was already height-bound, and the frame ends up with side gutters far
// wider than the legend that caused them; on a narrow or tall tile a column takes width the map
// needed. So the map is fitted BOTH ways and the larger fit wins - the column only by a clear
// margin (minGain), so a frame near the boundary keeps the band rather than flipping on a pixel.
//
// WHY IT IS A HELPER. The placement decides the fit box, the zoom area, the map clip, the legend's
// position and where the caption goes, and all of them must agree. Re-typed by hand, one of them
// keeps the old band: the map shrinks for nothing, or the pan catcher lands across the legend.
//
//   var lay = d3.llmLegendLayout({
//     width: W, height: H,
//     legend: { width: lw, height: lh },  // the legend block, labels included, drawn at (lay.legendX, lay.legendY)
//     band: legendBand,                   // the height a band takes off the map in band mode
//     edge: 'top',                        // where a band sits: 'top' (default) or 'bottom'
//     side: 'left',                       // where a column sits: 'left' (default) or 'right'
//     top: 0, bottom: 14,                 // strips the map never takes: a title or scrubber above, the note line below
//     pad: 6, inset: 8,                   // the map box's and the legend's inset from the frame
//     items: [{ text, fontSize, opacity, swatch }],  // caption lines after the legend: one fitted line each beside
//                                         // it in a band, wrapped under it in a column (swatch: a key square's colour)
//     projection: proj, object: fitCol,   // what is fitted - the fitted SCALE decides; proj is left fitted to lay.mapBox
//     fit: function (box) { ... return scale; }   // or a fit of your own (a world map's trim), returning the scale
//   });
//   lay.mode        -> 'band' | 'side'
//   lay.mapBox      -> [[x0, y0], [x1, y1]]: fit the map into this box
//   lay.legendX/Y   -> the legend block's top-left corner
//   lay.zoom        -> { originX, originY, width, height }: the map area for d3.llmGeoZoom, never over the legend
//   lay.clipTop     -> the y a map clip starts at (d3.llmWorldFit's clipTop)
//   lay.scale       -> { band, side }: both fitted scales (side null when no column fits the frame)
//   lay.items       -> [{ x, y, width, fontSize, lines }]: where each caption item goes (y = first baseline)
//   lay.drawItems(parent, { fg }) -> the y under the last item; every line fitted to its room, the whole
//                      text in a <title> when a line had to be cut
d3.llmLegendLayout = function (o) {
  var TYPE_FLOOR = 10;   // the minimum readable type, px: a caption line draws no smaller
  o = o || {};
  var W = +o.width > 0 ? +o.width : 0, H = +o.height > 0 ? +o.height : 0;
  var lg = o.legend || {};
  var lw = Math.max(0, +lg.width || 0), lh = Math.max(0, +lg.height || 0);
  var band = Math.max(0, +o.band || 0);
  var edge = o.edge === 'bottom' ? 'bottom' : 'top';
  var side = o.side === 'right' ? 'right' : 'left';
  var top = Math.max(0, +o.top || 0);
  var bottom = o.bottom == null ? 14 : Math.max(0, +o.bottom || 0);
  var pad = o.pad == null ? 6 : Math.max(0, +o.pad || 0);
  var inset = o.inset == null ? 8 : Math.max(0, +o.inset || 0);
  var minGain = +o.minGain > 1 ? +o.minGain : 1.05;
  var maxCol = +o.maxColumn > 0 ? +o.maxColumn : 0.34;   // a column wider than this share of W is never offered
  var LINE_GAP = 4, WRAP_GAP = 2, ITEM_GAP = 8;
  var items = (o.items || []).filter(function (it) { return it && it.text != null && String(it.text) !== ''; });
  var fsOf = function (it) { return Math.max(TYPE_FLOOR, +it.fontSize > 0 ? +it.fontSize : TYPE_FLOOR); };
  // The run of a line, by the 0.6 em the other helpers estimate with: a little wide on purpose, so a
  // line wrapped to the column is not then cut to it by the real glyphs.
  var run = function (s, fs) { return String(s).length * fs * 0.6; };
  var swatchRoom = function (it, fs) { return it.swatch ? Math.round(fs * 0.8) + 4 : 0; };
  var wrap = function (text, width, fs) {
    var words = String(text).split(/\s+/), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      if (!words[i]) continue;
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (cur && run(t, fs) > width) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  };

  var proj = o.projection, obj = o.object;
  var measure = typeof o.fit === 'function' ? o.fit
    : (proj && obj && typeof proj.fitExtent === 'function')
      ? function (box) { proj.fitExtent(box, obj); return proj.scale(); } : null;
  var scaleOf = function (box) {
    if (!measure || !(box[1][0] - box[0][0] > 1) || !(box[1][1] - box[0][1] > 1)) return null;
    var s = +measure(box);
    return isFinite(s) && s > 0 ? s : null;
  };

  // THE BAND: the frame's full width, the band's height taken off the map at its edge.
  var bandBox = edge === 'top'
    ? [[pad, top + band], [W - pad, H - bottom]]
    : [[pad, top + pad], [W - pad, H - band]];
  // THE COLUMN: the legend's own width plus its inset either side, the full height for the map.
  var colW = Math.ceil(lw + 2 * inset);
  var sideBox = side === 'left'
    ? [[colW, top + pad], [W - pad, H - bottom]]
    : [[pad, top + pad], [W - colW, H - bottom]];
  // In a column the caption wraps to the legend's width, so its height is known before the choice -
  // a column that cannot hold the legend AND its caption above the note line is never offered.
  var sideItems = [], itemsH = 0;
  for (var si = 0; si < items.length; si++) {
    var sfs = fsOf(items[si]);
    var sl = wrap(items[si].text, Math.max(1, lw - swatchRoom(items[si], sfs)), sfs);
    sideItems.push({ it: items[si], fs: sfs, lines: sl });
    itemsH += (si ? LINE_GAP : 0) + sl.length * sfs + (sl.length - 1) * WRAP_GAP;
  }
  var colNeed = inset + lh + (sideItems.length ? ITEM_GAP + itemsH : 0);
  var sideOk = W > 0 && H > 0 && lw > 0 && colW <= W * maxCol && colNeed <= H - top - bottom - 8;

  var sBand = scaleOf(bandBox);
  var sSide = sideOk ? scaleOf(sideBox) : null;
  var useSide = sSide !== null && sBand !== null && sSide >= sBand * minGain;
  // The projection is left fitted to the box chosen, so a caller that passed one can draw with it as is.
  if (sSide !== null && !useSide) scaleOf(bandBox);

  var lay = { mode: useSide ? 'side' : 'band', scale: { band: sBand, side: sSide } };
  if (useSide) {
    lay.mapBox = sideBox;
    lay.legendX = side === 'left' ? inset : W - inset - lw;
    lay.legendY = edge === 'top' ? top + inset : H - lh;
    lay.zoom = side === 'left'
      ? { originX: colW - 4, originY: top + 2, width: Math.max(1, W - colW + 4), height: Math.max(1, H - top - 2) }
      : { originX: 0, originY: top + 2, width: Math.max(1, W - colW + 4), height: Math.max(1, H - top - 2) };
    lay.clipTop = top;
  } else {
    lay.mapBox = bandBox;
    lay.legendX = edge === 'bottom' && side === 'right' ? W - inset - lw : inset;
    lay.legendY = edge === 'top' ? top + inset : H - lh;
    lay.zoom = edge === 'top'
      ? { originX: 0, originY: top + band - 4, width: W, height: Math.max(1, H - (top + band - 4)) }
      : { originX: 0, originY: top + 2, width: W, height: Math.max(1, H - band - (top + 2)) };
    lay.clipTop = edge === 'top' ? top + band - 4 : top;
  }

  // WHERE THE CAPTION GOES. Beside the legend in a band, each item one line fitted to the room right of
  // it (as the band always drew it); under the legend in a column, each item wrapped to the legend's
  // width - above it when the legend sits at the column's foot.
  lay.items = [];
  if (useSide) {
    var y = edge === 'top' ? lay.legendY + lh + ITEM_GAP : lay.legendY - ITEM_GAP - itemsH;
    for (var k = 0; k < sideItems.length; k++) {
      var s = sideItems[k];
      y += (k ? LINE_GAP : 0) + s.fs;
      lay.items.push({ x: lay.legendX, y: y, width: lw, fontSize: Math.max(TYPE_FLOOR, s.fs), lines: s.lines, item: s.it });
      y += (s.lines.length - 1) * (s.fs + WRAP_GAP);
    }
  } else {
    var bx = lay.legendX + lw + 12, by = lay.legendY;
    for (var b = 0; b < items.length; b++) {
      var bfs = fsOf(items[b]);
      by += (b ? LINE_GAP : 2) + bfs;
      lay.items.push({ x: bx, y: by, width: Math.max(0, W - bx - 8), fontSize: Math.max(TYPE_FLOOR, bfs), lines: [String(items[b].text)], item: items[b] });
    }
  }

  // Each line is fitted to its room (d3.llmFitLabel when the chart has it, else the estimated prefix
  // cut) - a column line was wrapped to fit, so it is cut only when the real glyphs run wider than the
  // estimate; a band line keeps the band's old rule, the widest prefix that fits.
  var fitLine = function (sel, room, text) {
    if (typeof d3.llmFitLabel === 'function') { d3.llmFitLabel(sel, room, { pad: 0, text: text }); return; }
    var fs = parseFloat(sel.attr('font-size')) || TYPE_FLOOR;
    if (run(text, fs) <= room) { sel.text(text); return; }
    var n = Math.max(0, Math.floor(room / (fs * 0.6)) - 1);
    sel.text(n > 0 ? text.slice(0, n) + '\u2026' : '');
  };
  lay.drawItems = function (parent, d) {
    d = d || {};
    var fg = d.fg || '#333', yEnd = lay.legendY + lh;
    if (!parent || !lay.items.length) return yEnd;
    var g = parent.append('g').attr('class', 'llm-legend-caption');
    for (var i = 0; i < lay.items.length; i++) {
      var p = lay.items[i], it = p.item, fs = Math.max(TYPE_FLOOR, p.fontSize), sw = swatchRoom(it, fs);
      // One group per item at its first baseline, so an item reads (and is found) as one block.
      var ig = g.append('g').attr('transform', 'translate(' + p.x + ',' + p.y + ')');
      if (it.swatch) {
        var sq = Math.round(fs * 0.8);
        ig.append('rect').attr('y', 1 - sq).attr('width', sq).attr('height', sq)
          .attr('fill', it.swatch).attr('stroke', '#ccc').attr('stroke-width', 0.5);
      }
      var full = String(it.text), cut = false, first = null;
      for (var j = 0; j < p.lines.length; j++) {
        var t = ig.append('text').attr('x', sw).attr('y', j * (fs + WRAP_GAP))
          .attr('font-size', fs).attr('fill', fg);
        if (it.opacity != null) t.attr('fill-opacity', it.opacity);
        fitLine(t, Math.max(0, p.width - sw), p.lines[j]);
        if (t.text() !== p.lines[j]) cut = true;
        if (!first) first = t;
      }
      // A sentence broken over lines, or cut, still reads whole on hover.
      if (first && (cut || p.lines.length > 1)) first.append('title').text(full);
      yEnd = p.y + (p.lines.length - 1) * (fs + WRAP_GAP) + Math.round(fs * 0.25);
    }
    return yEnd;
  };
  return lay;
};
// A FILTER THE CHART CANNOT SEE, NAMED. A page filter often narrows a chart's rows by a field the chart never
// receives: app A's KPI deck kept the title "North America" over the United States' totals after a country was picked, and its
// "rank" and "vs avg of n" compared the panels the filter left, with nothing on screen to say so. The host knows the filter; it
// hands it over as options.filterScope, and this turns it into the words a title and a comparison carry.
//
// CONTRACT
//   const scope = d3.llmFilterScope(options);
//   options.filterScope  a host fact: { field, values, label } - the field the filter is on, the values it keeps, and optionally
//                        the host's own phrase. Absent (or empty) means the host says nothing is narrowed, and nothing changes.
//   scope.narrowed       true when a filter narrows this chart's rows
//   scope.label          the filter in words: 'United States only', 'Canada and Mexico', 'Brazil and 3 more' - '' when not narrowed
//   scope.title(name)    a panel or chart title that says it is filtered: 'North America - United States only' (a middle dot);
//                        the name unchanged when nothing is narrowed
//   scope.among(text)    a comparison that says what it compares against: 'rank 2 of 3' -> 'rank 2 of 3 (United States only)';
//                        the text unchanged when nothing is narrowed
//   scope.baseline(key, compute)
//                        A COMPARISON BASELINE THAT A FILTER DOES NOT MOVE: a cohort mean or median a bar is drawn
//                        against. compute() reads it from the rows in view. When nothing is narrowed that IS the full cohort, and
//                        it is remembered under key on the d3 this chart runs with (one per chart in chart-host; the gate starts
//                        each check with none); when a filter narrows the rows the remembered full-cohort value is used, so one
//                        country filtered is never drawn against itself (the audited table's bars shrank to 1px). Returns
//                        { value, cohort } - cohort 'all' for the full cohort's value, 'shown' when no full value was ever seen
//                        (a chart first drawn already filtered), which the key then says ('vs the mean of those shown').
//   scope.domain(key, values)
//                        THE VALUES A COLOUR OR SIZE SCALE IS DOMAINED ON, KEPT FROM THE FULL ROWS. A colour that judges a measure
//                        means the same with or without a filter: a close rate of 40% drawn pale while every region shows must not
//                        turn the darkest colour once a region whose rates run from 20% to 40% is picked. values are the measure's
//                        values in view; when nothing is narrowed they ARE the full rows' and are remembered under key, as baseline
//                        remembers a number; when a filter narrows the rows the remembered values come back. Returns
//                        { values, lo, hi, cohort }: the finite numbers, their extent (null when there are none), and cohort 'all'
//                        or 'shown' as baseline's. Domain the scale on [lo, hi] (or hand values to a ramp), never on d3.extent
//                        over the rows drawn. A measure with a natural range (a rate from 0 to 100%) may take that range instead,
//                        which no filter moves either.
//   d3.llmFilterScope.reference(field, values)
//                        THE REFERENCE A MEASURE IS GOOD OR BAD AGAINST, FROM ITS NAME - the one rule every chart that draws a bar
//                        above or below a line shares. A measure against its own goal or plan (attainment, achievement, % of
//                        target, vs plan, to quota) is judged against 100%: { value: 1, kind: 'goal' } when its values are
//                        fractions (their median under 10), { value: 100, kind: 'goal' } when they are percents. A growth,
//                        change, gap, variance or delta is judged against 0: { value: 0, kind: 'zero' }. Anything else has no
//                        natural reference and returns null - only then is a cohort baseline (scope.baseline) the line, and the
//                        chart says so. A median line under an attainment column makes an owner at 75% of goal read as a beat.
d3.llmFilterScope = function (options) {
  var f = options && options.filterScope;
  var vals = [];
  if (f && typeof f === 'object' && f.values && typeof f.values.length === 'number' && typeof f.values !== 'string') {
    for (var i = 0; i < f.values.length; i++) {
      var v = f.values[i];
      if (v !== null && v !== undefined && String(v).trim() !== '' && vals.indexOf(String(v)) < 0) vals.push(String(v));
    }
  }
  var label = '';
  if (f && typeof f === 'object' && typeof f.label === 'string' && f.label.trim()) label = f.label.trim();
  else if (vals.length === 1) label = vals[0] + ' only';
  else if (vals.length === 2) label = vals[0] + ' and ' + vals[1];
  else if (vals.length > 2) label = vals[0] + ' and ' + (vals.length - 1) + ' more';
  var narrowed = label !== '';
  return {
    narrowed: narrowed,
    label: label,
    field: f && typeof f === 'object' && typeof f.field === 'string' ? f.field : '',
    values: vals,
    title: function (name) { return narrowed ? String(name) + ' \u00b7 ' + label : String(name); },
    baseline: function (key, compute) {
      var mem = null;
      try { mem = d3.__lchBaselines || (d3.__lchBaselines = {}); } catch (e) { mem = {}; }
      var k = String(key);
      if (!narrowed) {
        var v = typeof compute === 'function' ? compute() : compute;
        if (typeof v === 'number' && isFinite(v)) mem[k] = v;
        return { value: v, cohort: 'all' };
      }
      if (Object.prototype.hasOwnProperty.call(mem, k)) return { value: mem[k], cohort: 'all' };
      return { value: typeof compute === 'function' ? compute() : compute, cohort: 'shown' };
    },
    domain: function (key, values) {
      var mem = null;
      try { mem = d3.__lchBaselines || (d3.__lchBaselines = {}); } catch (e) { mem = {}; }
      var k = 'domain:' + String(key), shown = [];
      for (var i = 0; values && i < values.length; i++) {
        var n = values[i];
        if (n !== null && n !== undefined && n !== '' && typeof n !== 'boolean' && isFinite(+n)) shown.push(+n);
      }
      var out = function (v, cohort) {
        var lo = null, hi = null;
        for (var j = 0; j < v.length; j++) { if (lo === null || v[j] < lo) lo = v[j]; if (hi === null || v[j] > hi) hi = v[j]; }
        return { values: v, lo: lo, hi: hi, cohort: cohort };
      };
      if (!narrowed) {
        if (shown.length) mem[k] = shown.slice();
        return out(shown, 'all');
      }
      var kept = Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null;
      if (kept && typeof kept.length === 'number' && kept.length) return out(kept.slice(), 'all');
      return out(shown, 'shown');
    },
    among: function (text) { return narrowed ? String(text) + ' (' + label + ')' : String(text); }
  };
};
d3.llmFilterScope.reference = function (field, values) {
  var w = String(field == null ? '' : field).replace(/YoY|MoM|QoQ|WoW/g, function (m) { return ' ' + m.toLowerCase() + ' '; })
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  // a difference first: 'Gap To Plan' names a plan and is a gap, judged against 0
  if (/\b(growth|yoy|mom|qoq|wow|change|gap|variance|delta)\b/i.test(w)) return { value: 0, kind: 'zero' };
  if (!/\b(attainment|achievement|of (target|plan|quota|budget|goal)|vs\.? (target|plan|quota|budget|goal)|to (target|plan|quota|goal))\b/i.test(w)) return null;
  var v = [];
  for (var i = 0; values && i < values.length; i++) { var n = values[i]; if (n !== null && n !== undefined && n !== '' && isFinite(+n)) v.push(+n); }
  // a share of a goal is never negative; a column that is (a 'Revenue vs Plan' difference) is read against 0
  for (var k = 0; k < v.length; k++) if (v[k] < 0) return { value: 0, kind: 'zero' };
  v.sort(function (a, b) { return a - b; });
  var md = v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 1;
  return { value: md < 10 ? 1 : 100, kind: 'goal' };
};
// A FIELD'S NAME AS A READER SAYS IT. A data column is often named as an identifier - MarketingSpend, RevenueYoY,
// order_count - and an axis title, a legend title, a column header or a tooltip that prints it verbatim reads as code (app A's
// scatter: "MarketingSpend (USD, log scale)" and "RevenueYoY"). This turns a GLUED identifier into words and leaves a name that
// is already written for a reader alone.
//
// CONTRACT
//   d3.llmDisplayName(name)  'MarketingSpend' -> 'Marketing Spend', 'RevenueYoY' -> 'Revenue YoY', 'order_count' -> 'Order count',
//                            'CSATScore' -> 'CSAT Score', 'Q3Revenue' -> 'Q3 Revenue'; 'Revenue', 'CSAT', 'Net sales (USD)' and any
//                            name that already has a space come back unchanged. A short mixed-case token such as YoY, MoM or QoQ
//                            stays one word. Never throws: a non-string comes back as its String().
d3.llmDisplayName = function (name) {
  var s = name === null || name === undefined ? '' : String(name);
  if (!s || /\s/.test(s)) return s.trim();
  // snake_case, and kebab-case in lower case ('units-sold'), are words already: first letter up. A hyphen between capitalised
  // words ('Z-Score', 'Coca-Cola') is part of the name and stays.
  var t = s.replace(/[_]+/g, ' ');
  if (/^[a-z0-9]+(?:-+[a-z0-9]+)+$/.test(t)) t = t.replace(/-+/g, ' ');
  t = t.trim();
  if (t !== s) return t.charAt(0).toUpperCase() + t.slice(1);
  var parts = [];
  // a short mixed-case token (YoY, MoM, QoQ, WoW) is one word; otherwise split before an upper-case letter that starts a word
  // (after a lower-case letter or a digit) and before the last capital of an acronym run that a word follows (CSATScore)
  // (iPhone and eBay are one word; so are Q3, H1 and FY2024, and a span such as 7D or 30D)
  var re = /[a-z][A-Z][a-z]+|[A-Z][a-z][A-Z](?![a-z])|[A-Z]+[0-9]+|[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+|[0-9]+[A-Z](?![a-z0-9])|[0-9]+|[^A-Za-z0-9]+/g;
  var m;
  while ((m = re.exec(s)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    parts.push(m[0]);
  }
  if (parts.length < 2 || parts.join('') !== s) return s;
  // words are spaced; punctuation ('-', '(', ')') joins its neighbours as it was written
  var out = '';
  for (var i = 0; i < parts.length; i++) {
    var punct = /^[^A-Za-z0-9]+$/.test(parts[i]), prevPunct = i > 0 && /^[^A-Za-z0-9]+$/.test(parts[i - 1]);
    out += i === 0 || punct || prevPunct ? parts[i] : ' ' + parts[i];
  }
  return out.trim();
};


function render(container, data, options) {
  container.replaceChildren();
  const TYPE_FLOOR = 10;
  const { columns, rows } = data;
  const W = options.width, H = options.height;
  const CF = Math.max(TYPE_FLOOR, Math.min(14, Math.round(Math.min(W, H) / 55)));
  const SMALL_FS = Math.max(TYPE_FLOOR, CF - 2);
  const fg = options.themeFg || 'currentColor';
  const svg = d3.select(container).append('svg').attr('width', W).attr('height', H);
  if (options.backgroundColor) svg.style('background', options.backgroundColor);
  const fmt = new Intl.NumberFormat(options.cultureCode || 'en-US', { maximumFractionDigits: 2 });
  const cfmt = new Intl.NumberFormat(options.cultureCode || 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const geo = options.geo;

  const ci = n => columns.findIndex(c => c.name === n);
  const isoIdx = ci('__geoIso__'), idxIdx = ci('__rowIdx__');
  const revIdx = ci('Revenue'), countryIdx = ci('Country'), regionIdx = ci('Region');
  if (revIdx < 0) throw new Error('INVALID:column "Revenue" not found');
  const V = d3.llmValueColumn(columns, rows, { countLabel: 'Countries', excludeCoordinates: true, prefer: revIdx });

  const aggMode = (options.aggregation || '').toLowerCase();
  const aggNames = { average: 'Average', median: 'Median', min: 'Minimum', max: 'Maximum', count: 'Count of', distinct: 'Distinct count of' };
  const aggLabel = aggNames[aggMode] || 'Total';
  const valueName = aggLabel + ' ' + d3.llmDisplayName('Revenue');
  const agg = a => {
    if (aggMode === 'average') return d3.mean(a);
    if (aggMode === 'median') return d3.median(a);
    if (aggMode === 'min') return d3.min(a);
    if (aggMode === 'max') return d3.max(a);
    if (aggMode === 'count') return a.length;
    if (aggMode === 'distinct') return new Set(a).size;
    return d3.sum(a);
  };

  const byIso = new Map();
  let nullIsoCount = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r], iso = isoIdx >= 0 ? row[isoIdx] : null;
    if (iso == null || iso === '') { nullIsoCount++; continue; }
    let g = byIso.get(iso);
    if (!g) byIso.set(iso, g = { iso: iso, label: countryIdx >= 0 ? row[countryIdx] : iso, region: regionIdx >= 0 ? row[regionIdx] : null, vals: [], idx: [] });
    const raw = row[revIdx];
    const mv = (raw == null || raw === '' || !isFinite(+raw)) ? null : +raw;
    if (mv != null) g.vals.push(mv);
    g.idx.push(idxIdx >= 0 ? row[idxIdx] : r);
  }

  const placeholder = () => {
    svg.append('text').attr('x', W / 2).attr('y', H / 2).attr('text-anchor', 'middle')
      .attr('font-size', CF).attr('fill', fg).text(options.noDataText || 'No data to display');
  };
  if (!geo || !geo.features || byIso.size === 0) { placeholder(); return; }

  byIso.forEach(g => { g.value = g.vals.length ? agg(g.vals) : null; g.total = g.vals.length ? d3.sum(g.vals) : null; g.avg = g.vals.length ? d3.mean(g.vals) : null; });
  const featById = new Map(geo.features.map(f => [f.id, f]));
  const matched = [];
  byIso.forEach(g => { const f = featById.get(g.iso); if (f) matched.push(f); });

  const LEGW = 120, LEGH = 8, BAR_DY = CF + 6;
  const legendBand = 8 + BAR_DY + LEGH + 16 + LEGH + 6;
  const legW = Math.max(LEGW, Math.min(Math.round(W * 0.3), Math.ceil(valueName.length * SMALL_FS * 0.6)));
  const proj = d3.geoNaturalEarth1();
  const worldFit = (box, clipTop) => d3.llmWorldFit(proj, { geo: geo, regions: geo.features, width: W, height: H - 10,
    viewport: [W, H], box: box, fitPolygons: true, clipTop: clipTop });
  const lay = d3.llmLegendLayout({ width: W, height: H, legend: { width: legW, height: legendBand - 8 }, band: legendBand,
    fit: box => worldFit(box, 0).projection.scale() });
  const wf = worldFit(lay.mapBox, lay.clipTop);
  const path = wf.path;

  const vals = []; byIso.forEach(g => { if (g.value != null) vals.push(g.value); });
  const scaleLo = options.colorScaleLow || options.colorScaleAutoLow || '#BDD7E7';
  const scaleHi = options.colorScaleHigh || options.colorScaleAutoHigh || '#08519C';
  const ramp = d3.llmValueRamp({ values: vals, low: scaleLo, high: scaleHi }).onCanvas(options);
  const color = ramp.color;
  const land = ramp.landFill(options.geoLandColor);
  const noData = options.geoNoDataColor ? ramp.landFill(options.geoNoDataColor) : land;

  const z = d3.llmGeoZoom(svg, { width: lay.zoom.width, height: lay.zoom.height, originX: lay.zoom.originX, originY: lay.zoom.originY,
    themeFg: options.themeFg, backgroundColor: options.backgroundColor, fontSize: CF, maxScale: 8 });
  const gMap = z.group({ stroke: 0.5, dotStroke: 0.7 });
  wf.clip(svg, gMap);

  const cxy = (c, i) => (c && isFinite(c[i]) ? Math.round(c[i] * 10) / 10 : null);
  const strokeC = options.backgroundColor || options.themeBg || '#ffffff';
  const polys = geo.features.filter(f => f.geometry && f.geometry.type !== 'Point');
  gMap.selectAll('path').data(polys, f => f.id).join('path')
    .attr('d', path)
    .attr('class', f => byIso.has(f.id) ? 'd3-mark' : null)
    .attr('data-row-idx', f => byIso.has(f.id) ? byIso.get(f.id).idx.join(',') : null)
    .attr('data-cx', f => byIso.has(f.id) ? cxy(path.centroid(f), 0) : null)
    .attr('data-cy', f => byIso.has(f.id) ? cxy(path.centroid(f), 1) : null)
    .style('cursor', f => byIso.has(f.id) ? 'pointer' : null)
    .attr('fill', f => { const g = byIso.get(f.id); return !g ? land : (g.value == null ? noData : color(g.value)); })
    .attr('stroke', strokeC).attr('stroke-width', 0.5);

  const pts = matched.filter(f => f.geometry && f.geometry.type === 'Point');
  const prAuto = Math.max(3, Math.min(7, Math.round(Math.min(W, H) / 90)));
  const prSet = +options.geoPointRadiusPx;
  const pr = (isFinite(prSet) && prSet > 0) ? Math.max(1, Math.min(24, prSet)) : prAuto;
  gMap.selectAll('circle').data(pts, f => f.id).join('circle')
    .attr('class', 'd3-mark')
    .attr('cx', f => proj(f.geometry.coordinates)[0]).attr('cy', f => proj(f.geometry.coordinates)[1])
    .attr('r', pr)
    .attr('data-row-idx', f => byIso.get(f.id).idx.join(','))
    .attr('data-cx', f => proj(f.geometry.coordinates)[0]).attr('data-cy', f => proj(f.geometry.coordinates)[1])
    .style('cursor', 'pointer')
    .attr('fill', f => { const v = byIso.get(f.id).value; return v == null ? noData : color(v); })
    .attr('stroke', fg).attr('stroke-opacity', 0.6).attr('stroke-width', 0.7);

  if (options.allowTooltips !== false) {
    const tip = d3.llmTooltip(container);
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    gMap.selectAll('.d3-mark')
      .on('mousemove', (event, f) => {
        const g = byIso.get(f.id);
        let body;
        if (g.value == null) body = 'No data';
        else if (g.vals.length > 1) body = 'Total ' + cfmt.format(g.total) + ' · Avg ' + cfmt.format(g.avg) + ' · ' + g.vals.length + ' rows'
          + (aggMode && aggMode !== 'sum' ? '<br/>' + esc(valueName) + ': ' + fmt.format(g.value) : '');
        else body = esc(valueName) + ': ' + fmt.format(g.value);
        tip.show('<b>' + esc(g.label) + '</b>' + (g.region != null ? ' (' + esc(g.region) + ')' : '') + '<br/>' + body, event);
      })
      .on('mouseleave', () => tip.hide());
  }

  const hostUnm = options.geoUnmatched && options.geoUnmatched.count;
  const unm = Math.max(hostUnm || 0, nullIsoCount);
  if (unm > 0) {
    const unmText = d3.llmPlaceUnit(data).count(unm) + ' unmatched';
    const unmG = svg.append('g').attr('class', 'lch-caption');
    const unmT = unmG.append('text').attr('x', 8).attr('y', H - 8).attr('font-size', CF).attr('fill', fg);
    d3.llmFitLabel(unmT, W - 16, { pad: 0, text: unmText });
    if (unmT.text() !== unmText) unmG.insert('title', ':first-child').text(unmText);
  }

  const LEGX = lay.legendX, LEGY = lay.legendY + BAR_DY;
  const gid = 'llmgeo-' + Math.abs((W * 131 + H) | 0);
  ramp.drawLegend(svg, { x: LEGX, y: LEGY, width: LEGW, height: LEGH, labelY: LEGH + 10, fontSize: SMALL_FS,
    fg: fg, format: v => cfmt.format(v), id: gid, stroke: fg });
  const L = svg.append('g').attr('transform', 'translate(' + LEGX + ',' + LEGY + ')');
  const nameT = L.append('text').attr('y', -6).attr('font-size', SMALL_FS).attr('fill', fg).attr('fill-opacity', 0.85);
  d3.llmFitLabel(nameT, lay.mode === 'side' ? legW : W - LEGX - 8, { pad: 0, text: valueName });
  if (nameT.text() !== valueName) nameT.append('title').text(valueName);
  let ndCount = 0; byIso.forEach(g => { if (g.value == null) ndCount++; });
  if (ndCount > 0 && noData !== land) {
    const S = L.append('g').attr('transform', 'translate(0,' + (LEGH + 16) + ')');
    S.append('rect').attr('width', LEGH).attr('height', LEGH).attr('fill', noData).attr('stroke', fg).attr('stroke-opacity', 0.4).attr('stroke-width', 0.5);
    S.append('text').attr('x', LEGH + 4).attr('y', LEGH - 1).attr('font-size', SMALL_FS).attr('fill', fg).text('no data');
  }
}
