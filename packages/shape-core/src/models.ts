export type LLMRequestModifier =
    {
        code: string,
        not: boolean,
        userText?: string
    };

export type SimpleColumn =
    {
        name: string,
        dataType: string,
        tableName: string
    }

export type VegaRendererPayload =
    {
        vegaType: string,
        vegaMode: string,
        configSpec?: string
    }

export type LLMColumnWithValue =
    {
        name: string,
        dataType: string,
        modelDesc?: string,
        lowValue?: any,
        highValue?: any,
        avgValue?: any,
        medianValue?: any,
        distinctCount?: number,
        blankCount?: number,
        avgLength?: number,
        modelFormat?: string,
        dateWithTime?: boolean,
        isMeasure: boolean,
        numericPrecision?: number,
        topCategories?: number[],
        valueNature?: string,
        // Client-side temporal classification (2026-06-05). The client has the
        // ACTUAL cell values, so it can recognise temporal axes the server's
        // summary model can't — a DateTime column, a year-as-integer, OR a
        // PERIOD STRING ("2024-Q1", "2024-01", "Jan 2024"). Ships a boolean (never
        // the raw values). The server's ChartFilter temporal gates (HasDate /
        // NeedsTimeProgression) trust this flag first, falling back to their own
        // DateTime/year-int heuristic for older clients that don't send it.
        isTemporal?: boolean,
        // A DATE STORED AS TEXT, and how to read it (2026-08-19). Set ONLY on a String
        // column whose values are full calendar dates - "2024-03-15", "15/03/2024",
        // "03.15.2024" - so that isTemporal above is true for a reason the server and the
        // generated code can ACT on. Genesis: a real user's project schedule arrived with
        // four date columns typed as text (a CSV import, Spanish locale); nothing
        // recognised them as dates, every time-based chart was ineligible, and the user
        // was handed a network diagram whose nodes were dates. A boolean alone would have
        // made Gantt ELIGIBLE and then left the code parsing "15/03/2024" with
        // new Date(), which is Invalid Date - so the PATTERN ships with the flag.
        //
        // The value is a strptime / d3.timeParse specifier - "%Y-%m-%d", "%d/%m/%Y",
        // "%m/%d/%Y", "%d.%m.%Y", "%Y-%m-%dT%H:%M:%S" - because that one vocabulary is
        // read verbatim by d3.timeParse AND by Python's strptime / pandas to_datetime,
        // so a single field serves every renderer. Day/month ORDER is resolved from the
        // values when any value decides it (a first field over 12 is a day), and from
        // the host locale otherwise (en-US reads month-first; the rest of the world
        // day-first). A pattern, never a value: it is opaque to every source cell and
        // ships at EVERY privacy tier. Absent on DateTime columns (they need no
        // parsing), on measures, on period strings ("2024-Q1"), and on older clients.
        temporalTextPattern?: string,
        // Client-measured ADDITIVITY of a measure column (2026-06-05). The client
        // has the real cell values, so it can MEASURE whether a measure stacks /
        // sums meaningfully instead of guessing from the column NAME (the old
        // server-side regex approach that mislabeled "Channel_Revenue_Share" as a
        // forbidden rate). Ships an enum only — never raw values.
        //   "additive"       — sums/stacks meaningfully (revenue, counts). Group
        //                       sums vary with group size.
        //   "part_of_whole"  — a share / % of total: the parts sum to a CONSTANT
        //                       whole (1 or 100) under grouping, so it legitimately
        //                       stacks to 100%. partOfWholeDim names the dimension
        //                       it partitions; wholeWasPercent distinguishes 100 vs 1.
        //   "intensive_rate" — an independent rate/ratio (margin, NPS, uptime%):
        //                       summing is meaningless → use mean/median, never stack.
        //   "unknown"        — undecidable here (data still loading, or no host
        //                       aggregation hint on a bare DAX measure). The server
        //                       falls back to its legacy name-regex for these.
        // Only set on measure columns. See classifyAdditivity in IndexedText.ts.
        additivity?: "additive" | "part_of_whole" | "intensive_rate" | "unknown",
        partOfWholeDim?: string,
        // Host metadata (DataViewMetadataColumn.discourageAggregationAcrossGroups,
        // 2026-06-05): the model marked this measure non-summable (ratio/average/
        // model measure). Fed into classifyAdditivity as an authoritative intensive
        // signal (after the part-of-whole data test). Closes the explicit-DAX gap.
        discourageAggregationAcrossGroups?: boolean,
        skewness?: number,
        // Tier 1 statistical-shape additions (2026-05-21). Aggregates over
        // the WHOLE column — describe shape, never reveal raw values.
        // Computed in IndexedText.updateColumnStats20 (O(n) per column,
        // reuses existing scans, no extra round-trip).
        //   stdDev:          population standard deviation. Numeric only.
        //                    Combined with avgValue, gives σ/μ — the
        //                    cleanest "is this measure flat?" signal.
        //   sum:             total of all numeric values. Lets the server
        //                    pre-compute Top-N share for rule (e) without
        //                    waiting for codegen runtime self-check.
        //   modalShare:      0.0-1.0 fraction of non-blank rows in the
        //                    most-common categorical value. Detects
        //                    dominance patterns ("Country=US=87%").
        //   sortedDirection: "asc" / "desc" / "none" — was the source
        //                    column already in order? Helps detect
        //                    implicit time series.
        stdDev?: number,
        sum?: number,
        modalShare?: number,
        sortedDirection?: "asc" | "desc" | "none",
        // Tier 2 shape additions (2026-05-25). Both gated to pl >= 20 (same
        // privacy class as sampleCsv) — they're a richer view of what the
        // raw rows already permit, not a new leak class.
        //   topCategoryValues: the actual VALUE LABELS of the top-K most
        //                      common categorical entries, paired by index
        //                      with the first K entries of topCategories
        //                      (the counts). Without these, the LLM saw
        //                      shape (long-tail vs uniform) but had to
        //                      guess semantic type from the column NAME
        //                      alone. With them, airport-code / ISO-country
        //                      / weekday / id-like recognition is direct.
        //                      K=5 keeps the wire small (~150B per column).
        //   quantiles:         p05/p25/p75/p95 for numeric columns. Lets
        //                      the LLM decide log-scale / axis-truncation
        //                      from explicit outlier signal instead of
        //                      inferring from min/max/avg/median. Powers
        //                      the "outlier-squashed-bars" failure class
        //                      (Image-1 case from the 2026-05-16 review).
        topCategoryValues?: string[],
        quantiles?: { p05?: number, p25?: number, p75?: number, p95?: number },
        // Format-signature derived from raw values BEFORE obfuscation (see
        // formatDetector.ts). Populated only for String-dataType columns —
        // replaces topCategoryValues for those, which used to ship
        // class-preserving obfuscated tokens for the LLM to back-infer
        // format from. Now the inference is done once on the client and
        // shipped as a single enum-like string (e.g. "ALL_UPPER_FIXED_3"
        // for IATA codes, "TITLE_CASE_WORDS" for proper names, "EMAIL_LIKE",
        // "OPAQUE_ID_ALPHANUMERIC", etc.). Non-String dataTypes still
        // ship raw topCategoryValues — their values aren't private and
        // the LLM needs them verbatim (Boolean true/false, etc.).
        formatSignature?: string,
        // Client-side ordinal-scale detection (2026-05-26). Set when this
        // categorical column's distinct values match a known ordinal catalog
        // pattern — Likert agreement / satisfaction / quality, frequency,
        // intensity, severity, importance, etc. (see ordinalDetector.ts).
        //   ordinalPattern: catalog name, e.g. "likert5_agreement". Telemetry +
        //                   server-side conditional logic. NULL when no match.
        //   orderedDomain:  the user's ORIGINAL value strings (preserving
        //                   their capitalization / spacing / pluralization)
        //                   sorted into the catalog pattern's inherent order.
        //                   The LLM passes this array directly into a
        //                   `domain(...)` call at render time so the axis
        //                   honors Likert order (Strongly Disagree → Strongly
        //                   Agree) rather than alphabetical or count-desc.
        // Detection runs BEFORE obfuscation. Shipping the matched values is
        // not a privacy concern — Likert / frequency / intensity terminology
        // is public-domain, and the LLM-emitted code reads the same strings
        // out of data.rows at render time anyway.
        ordinalPattern?: string,
        orderedDomain?: string[],
        // Tier B safe short-code values (2026-05-31). Set when a categorical is
        // NOT a recognized ordinal but its values are clearly non-PII short
        // codes (≤2 alphabetic chars each, ≤15 distinct — see
        // safeDistinctValuesToShip). Carries the ACTUAL distinct values
        // (unobfuscated, NO order claim) so the LLM derives the axis domain
        // from real data instead of guessing labels it can't see (the freemium
        // empty-filter failure, a production incident). Privacy: this ships actual
        // user values, so — like orderedDomain — it is gated to privacy level
        // >= 20 ("+Include Column Detailed Stats") in IndexedText and omitted
        // below that. See the Privacy Level setting description.
        safeDistinctValues?: string[],
        // Set on columns that came from the "Group by" well (2026-05-28). These
        // are the user-declared PRIMARY grouping/series dimension(s) and map to
        // the leading matrix hierarchy levels. The server turns this into a
        // codegen directive ("lead the visualization with these as the series /
        // breakdown"); the host also mints group-level selectionIds for them so
        // drill-through / context-menu act at the group granularity.
        isGrouping?: boolean,
        // Date-hierarchy unshred tags (2026-06-27). When PBI shredded a Date into
        // Year/Quarter/Month/Day, the client KEEPS those parts (isDatePart=true) and
        // ADDS one reassembled DateTime column (isReassembledDate=true); both carry the
        // same dateGroupId. Lets the server treat the whole hierarchy as ONE dimension
        // (don't double-count parts + Date in flow/coverage gates) and hide the synthetic
        // Date from the displayed SourceFieldList. Absent on non-date / legacy clients.
        isDatePart?: boolean,
        isReassembledDate?: boolean,
        dateGroupId?: string,
        // Per-column value-set OVERLAP statistic (2026-06-07). For each OTHER
        // non-measure column, the PERCENT of THIS column's distinct values that
        // also appear in that column. A STATISTIC about values (never the values
        // themselves) — lets the server KNOW, not guess, whether two categorical
        // dimensions share members (a node that is both a source and a target →
        // bidirectional flow → don't colour nodes by role) or are disjoint
        // (bipartite). Computed in IndexedText; privacy-safe (a percent + a column
        // name the server already has).
        sharedValueRatioWithOthers?: { otherColumn: string, percentShared: number }[]
        // Per-column CATEGORICAL-PAIR fill statistic (2026-06-13). For each OTHER
        // low-cardinality non-measure column, how DENSELY the two columns co-occupy
        // their value grid (fillPct = distinct (this,other) pairs / cardThis*cardOther),
        // and whether THIS column 1:1-determines the other (determinesOther). Privacy-
        // safe (counts/ratios + a column name the server has). Lets the server pick an
        // INDEPENDENT dense axis pair for heatmap/matrix charts instead of crossing two
        // functionally-dependent categoricals (a denormalized spec table → a diagonal).
        // minCellCount (2026-06-20): smallest co-occurring (this,other) cell row
        // count — the sparsest group a distribution chart (box/violin) would draw
        // when split by this pair. A box/whisker on a handful of points overstates
        // quartile precision; the server suppresses box geometry below a threshold.
        // distinctCombinations (2026-07-27): the RAW distinct (this,other) pair count
        // fillPct was already derived from (fillPct = round(distinctCombinations /
        // (cardThis*cardOther) * 100)) but never itself shipped — a downstream consumer
        // could only reconstruct it approximately from a rounded percentage. Added so a
        // HIERARCHY chart's true leaf count is a fact the server can read, not a guess:
        // for a well-formed hierarchy, the (deepest-child, its 1:1 parent) pair's
        // distinctCombinations equals the TRUE leaf count of the whole chain, however
        // many coarser levels sit above it, because each intermediate level is itself
        // 1:1-determined (primaryParentColumn below) — no separate N-way count needed.
        // Genesis: a Dendrogram's own leaf count was estimated server-side as the single
        // largest column's DistinctCount (34, Subcategory alone) when the true nested
        // (Department,Category,Subcategory) leaf count was 40 — 4 subcategory NAMES
        // legitimately repeat under different parent categories, which only a real
        // pairwise count (not a single column's cardinality) can see. Consumption is
        // v2.2 (RELEASE-PLAN.md item 15); this ships the fact now so it exists.
        categoricalPairStats?: { otherColumn: string, fillPct: number, determinesOther: boolean, minCellCount?: number, distinctCombinations?: number }[]
        // NESTING DIRECTION (2026-06-18). determinesOther is bidirectional; this resolves it:
        // when THIS column 1:1-determines a STRICTLY coarser column, THIS column is NESTED
        // UNDER it and primaryParentColumn names that (coarsest) parent. nestingRatio =
        // cardParent/cardThis (<1). Lets the server deterministically detect a parent-nested
        // stack / partition (a series that is the parent of the x dimension) instead of asking
        // the LLM to spot the 1:1 relationship. Absent when the column nests under nothing.
        primaryParentColumn?: string
        nestingRatio?: number
        // GROUP-DISCRIMINATION statistics (2026-06-19), measure columns only.
        // relativeDispersion = (p90-p10)/|median| over raw rows — near 0 ⇒ the
        // measure is effectively constant. groupDiscrimination[dim].eta2 =
        // SS_between/SS_total (0..1) — the fraction of this measure's variance
        // explained by each low-cardinality categorical; near 0 ⇒ that dimension
        // does NOT differentiate the measure (no chartable signal when grouping/
        // colouring/faceting by it). Thresholds applied SERVER-side. Privacy-safe
        // (ratios + a column name the server has, never raw values).
        relativeDispersion?: number
        groupDiscrimination?: { otherColumn: string, eta2: number }[]
        // minGroupCount (2026-06-20): row count of this column's RAREST value — the
        // sparsest group a single-categorical distribution split (box/violin) would
        // draw. Pair-wise sparsity is on categoricalPairStats.minCellCount.
        minGroupCount?: number
        // isBinaryFlag (2026-06-20): a 2-value boolean/outcome categorical (true/false,
        // yes/no, 0/1, or a 2-value column with an outcome name). Lets the server refuse
        // the circular pattern — split/facet by it AND colour by a rate OF it (within-cell
        // rate is 100%/0%). The recurring default-rate heatmap bug (recurring in production).
        isBinaryFlag?: boolean
        // collinearWithMeasures (Layer C, 2026-06-20): for a MEASURE, the names of the
        // OTHER measures it is ~collinear with (|Pearson r| >= 0.98 over the rows where
        // both are present) — they encode the SAME axis (e.g. Views and 2×Views, a value
        // and its running total). Lets the server KNOW whether two INDEPENDENT continuous
        // axes exist: a correlation chart (scatter/regression/bubble) on collinear-only
        // measures is a trivial diagonal. Only present (and only on measures that ARE
        // collinear with something) when the client computed it; absent ⇒ no signal.
        collinearWithMeasures?: string[]
        // isFreeText (Layer C, 2026-06-20): a non-measure categorical whose values are
        // WORDS (word-like format signature + non-trivial average length), as opposed to
        // IDs / codes / dates / booleans. A word cloud needs words; the server prefers
        // this flag over re-deriving from formatSignature. Absent ⇒ fall back to format.
        isFreeText?: boolean
        // GEO detection (geo/choropleth Phase 0, 2026-07-21). Set when this column's
        // distinct values resolve to a geographic dimension (see geoDetector.ts). All
        // three are a summary — an enum + a percent + a bool, NEVER raw values — so they
        // ship unconditionally (privacy-safe, like isTemporal), independent of the
        // pl>=20 actual-value gate.
        //   geoKind:      the most specific kind matched — "country-iso3" | "country-iso2"
        //                 | "country-name" | "us-state-code" | "us-state-name" | "us-zip5"
        //                 | "us-county-fips". The server's ChartFilter offers the matching
        //                 choropleth type only when a geo dim of the right kind exists
        //                 (Phase 1 gate); inert until then.
        //   geoMatchPct:  % of distinct values that resolved (server gate re-checks
        //                 against sysparm LLMGeoMinMatchPct).
        //   geoAmbiguous: a known single-column code collision (ISO-2 vs USPS, ZIP vs
        //                 county-FIPS, country-name vs US-state-name) that can't be
        //                 disambiguated from this column alone → the gate stays conservative.
        geoKind?: string
        geoMatchPct?: number
        geoAmbiguous?: boolean
        // WHICH MAP FITS, as opposed to whether the column is geographic at all. Set only on
        // country-kind columns, ROW-WEIGHTED over the distinct values: forty US rows and one
        // Japanese row is a US dataset, and counting distinct values alone would call it
        // 50/50 global. Answers the case where a country column clears the world-choropleth
        // floor and then draws a world that is grey everywhere except one continent — legal,
        // and the regional frame would have been better.
        //   dominantGeoRegion:    "north-america" | "south-america" | "europe" | "africa"
        //                         | "asia" | "oceania" | "antarctica"
        //   dominantGeoRegionPct: share of resolved rows in that region, 0..100
        //   geoRegionCount:       distinct regions present — 1 is the grey-world case, and a
        //                         spread of four is a genuinely global dataset
        // Absent on older clients ⇒ no signal ⇒ today's behaviour, so this fails open.
        dominantGeoRegion?: string
        dominantGeoRegionPct?: number
        geoRegionCount?: number
    }

// Raw setting/viewport/shape state shipped on every Generate. Server's
// ModifierResolver turns this into LEGENDRULES / LABELDENSITY /
// LEGENDPLACEMENT / INCTITLE / INCDPVALS / GENTYPE_* / SUGGESTEDCHART /
// LIMITTO / LIMITCNT / OTHERSLABEL / DATESUM / FONTFAMILY / USERTEXT /
// LIKEVER+CHANGETEXT modifiers — single source of truth for what was
// previously duplicated in visual.ts and harness/client.py. The visual
// keeps client-emitting only modifiers driven by state the server can't
// see: AVOIDERR (last-attempt error), PLOTLY_INTERACTIVE (renderer wire).
export type LLMClientHints =
    {
        viewportWidth?: number,
        viewportHeight?: number,
        rowCount?: number,
        maxNonMeasureCardinality?: number,
        // Python-env device facts (2026-07-17, from production). Proactive
        // self-report so the server can steer the AUTO renderer pick away from pyodide lanes.
        // pyProbeOk = active pyodide smoke-test verdict (undefined until the probe has run).
        pyWasmOk?: boolean,
        pyEnvFailedBefore?: boolean,
        pyProbeOk?: boolean,
        // Distinct count of the non-measure dimension tuple (leaf grain). Lets the server
        // decide deterministically whether an implicit row count aggregates or is degenerate.
        leafCardinality?: number,
        randomSeed?: number,
        favorTitle?: string,           // "", "1", "0"
        legendPlacement?: string,      // "", "outside", "inside"
        favorDPValues?: string,        // "", "1", "0"
        favorGeneralType?: string,     // "", "NT", "TR"
        allowGeneratedMeasures?: string, // "", "YES", "NO" — Leave to Visual / explicit yes / explicit no
        industryContext?: string,      // "" = N/A, else an industry label (e.g. "Logistics & shipping") for domain-aware metric naming
        favorStyle?: string,
        favorLimitTo?: string,
        favorLimitCount?: number,
        groupToOthersLabel?: string,
        // Allow Group to Others (2026-06-05, default true). ON → a limit groups the
        // remainder into an 'Others' bucket (nothing dropped). OFF → the remainder
        // is dropped (leaderboard). Governs all Favor Limit To modes.
        allowGroupToOthers?: boolean,
        // User-favored analytical overlay (2026-06-05) — "" = leave to visual,
        // else moving_avg / trend_line / anomaly / confidence_band / forecast / yoy.
        // A STRONG SUGGESTION to the validator (or codegen when no validator pass):
        // add it where it fits the chart + data. Safe to honor for freemium (enum,
        // not free text) — the only structured overlay channel a freemium user has.
        favorEnhancement?: string,
        favorDateSum?: string,
        suggestFontFamily?: string,
        userCommentary?: string,
        inChartCaption?: boolean,
        useDifferentFromLast?: boolean,
        useSimilar?: boolean,
        codeVersion?: number,
        hoverSimText?: string,
        // "Generate New" variety set (design B): every chart type shown this session.
        // On a Generate New the server avoids these so repeated clicks cycle through
        // different types; the client is the memory (no server-side DB read).
        avoidChartTypes?: string[],
        // Validator "adventurousness" override (2026-06-23): probability [0..1] that
        // the engine favors an atypical-but-still-valid chart over the obvious best
        // fit, for cross-instance variety. undefined = use the server default
        // (SystemParameter LLMValidatorAdventurousPct). Blank client setting → undefined.
        adventurousPct?: number,
        // Auto-regen diagnostic (2026-06-24): decision-term breakdown the server logs
        // to the server log so a spurious "Change Creates New" regen is DB-traceable.
        regenDiag?: string,
        // Ceiling on how many distinct places a point map will plot (Format > Data "Max
        // Map Points", default 1000) before the type stops being offered. A HARD gate —
        // applies even to an explicit chart-type pick, since it bounds mark count, not
        // aesthetics. Undefined on older clients → server falls back to its own default.
        maxMapPoints?: number,
        // WHERE THE COORDINATES ACTUALLY SIT — a cross-column signal, so it rides here rather
        // than on any one column. Present only when the data carries a latitude/longitude pair
        // the client could measure; absent ⇒ no signal ⇒ today's behaviour.
        //
        // It exists because the lat/lon gate is a NAME heuristic with no idea where the points
        // land: a table of European cities with coordinates satisfies it and is then offered a
        // North America basemap, with every point off the map or piled at its edge. pctUsa and
        // pctNa answer that; the p5/p95 envelope describes the bulk of the data without letting
        // one null-island row rewrite it; and n is carried because a percentage from three rows
        // is not the same claim as one from three thousand.
        geoExtent?: {
            pctUsa: number, pctNa: number,
            latP5: number, latP95: number, lonP5: number, lonP95: number,
            n: number,
        },
        // LEVEL OF DETAIL: "High" | "Medium" | "Low", or absent for "Leave to
        // visual". How much of the data the viewer wants to SEE - every observation as its own
        // mark, the distribution, or one mark per category.
        //
        // A STRONG NUDGE, never a gate: the server applies it as a scoring multiplier that can
        // only demote, so it reorders charts that already fit and can never make one impossible.
        // An explicitly picked chart type still wins outright.
        //
        // Typed as a plain string rather than a union ON PURPOSE - an unrecognised value must be
        // ignored by the server (it maps to multiplier 1.0), so the wire stays forgiving across
        // client/server version skew in both directions.
        levelOfDetail?: string,
    };

export type LLMRequestCode =
    {
        licenseKey: string,
        licensee: string,
        secretKey: string,
        freemiumKey?: string,
        clientVersion?: string,
        identifier?: string,
        cultureCode?: string,
        genNew?: boolean,
        version?: number,
        // Set when re-pulling the SAME version because the server's
        // cachedVersionOutputHash differed from our stored cachedOutputHash (an
        // in-place history-editor edit). Tells the server to skip the cached-serve
        // charge — syncing the user's own edit is free (verified server-side
        // against owned unlocked clones).
        editSync?: boolean,
        // RECOVERY POLL (2026-08-19, from a production incident). A client that lost the transport
        // mid-generate - or re-mounted with a persisted pending-generate marker -
        // asks for the version that generate would have produced (genNew:false,
        // version:N). With this flag the server only ever FETCHES: a miss comes
        // back as isVersionNotFound, never as a fresh (billed) generation.
        fetchOnly?: boolean,
        model?: string,
        // Requested renderer — the "Render Type" setting ("" / VISUAL = leave to
        // visual, or explicit D3 / PLOTLY / PYMATPLOT / VEGA).
        renderer?: string,
        // Requested output LANGUAGE — the "Language" setting ("" = none, "javascript"
        // → D3/Vega, "python" → Plotly/matplotlib). On the AUTO (VISUAL) renderer path
        // the server narrows the pick to this language's engines; ignored when renderer
        // is concrete. Shared with the MCP/SDK client (bicApi sends the same field).
        language?: string,
        // Resolved (actual) renderer of the code currently shown, derived from
        // codeLang. On a code-revision the server pins to this so the edit reuses
        // the original render contract (e.g. D3 options.palette) instead of
        // re-running the picker. Empty when no code yet. (2026-06-19)
        resolvedRenderer?: string,
        totalRows: number,
        width: number,
        height: number,
        palette?: string,
        backgroundColor?: string,
        backgroundOpacity?: number,
        // Report theme foreground/background + high-contrast state (host colorPalette),
        // so the codegen prompt can theme chrome/text and honor high-contrast for every
        // renderer (Python bakes; D3 also reads these live from render options).
        themeBg?: string,
        themeFg?: string,
        isHighContrast?: boolean,
        // User-forced continuous colour-scale endpoints (Format > Colors pickers;
        // empty = automatic palette-anchored scale). General: any colormap, any chart
        // type. Python renderers bake at codegen; D3 also reads the same values live
        // from render options (options.colorScaleLow/High) — never forces a regen.
        colorScaleLow?: string,
        colorScaleHigh?: string,
        // Map fill colours (Format > Colors pickers; empty = automatic light grey).
        // LAND = the basemap, i.e. everywhere the data doesn't reach; NO-DATA = a region
        // that IS in the data's geography but has no value for this view (empty = follows
        // land). D3 reads both live from render options and needs nothing here — these
        // ride the request purely so the BAKED renderers (Plotly/matplotlib), which can
        // only honor a colour at codegen, can honor them too. Never forces a regen.
        geoLandColor?: string,
        geoNoDataColor?: string,
        // Forced display aggregation for the chart's own per-group summarization
        // (sum/average/median/min/max/count/distinct; "" = Auto). Python bakes; D3
        // reads options.aggregation live. Never forces a regen.
        aggregation?: string,
        // Forced chart orientation ("horizontal"/"vertical"; "" = auto). Primarily a
        // prose→settings-mapper / MCP directive; codegen honors it where a chart has a
        // meaningful orientation. Never forces a regen.
        orientation?: string,
        temp?: number,
        modifiers?: LLMRequestModifier[],
        shape?: LLMColumnWithValue[],
        sampleCsv?: string,
        clientId?: string,
        instanceKey?: string,
        triesLeft: number,
        maxTries: number,
        rendererSpecificPayload?: string,
        reasoningMode?: string,
        // Capability flag — server uses this to avoid picking Vega when the
        // client can't render it (server-side default is true to keep older
        // clients without this field working). Mirrors VEGA_RENDERER_ENABLED.
        supportsVega?: boolean,
        // Per-renderer capability flags for Plotly + D3. Optional on the wire:
        // when absent the server falls back to a client-version check
        // (`>= 2.0.0.0`) so existing 2.0 visuals that pre-date these fields
        // keep working. 1.0 visuals (which lack Plotly/D3 applyRenderAsync
        // branches) don't send them either, and the version-fallback returns
        // false — server's renderer picker then clamps to PYMATPLOT instead
        // of handing back unrenderable code. Mirrors PLOTLY_RENDERER_ENABLED
        // and D3_RENDERER_ENABLED in settings.ts.
        supportsPlotly?: boolean,
        supportsD3?: boolean,
        // This build can read an NDJSON streaming response from /api/LLMChart.
        // When true, the server streams progress lines + a final result line
        // (keeps bytes flowing so intermediary timeouts don't sever a long
        // Generate). Absent/false → server returns a single buffered JSON.
        supportsStreaming?: boolean,
        // Per-Generate correlation ID minted by the client. Server stamps
        // every LogServer line with "corr=<id>"; client batches use the same
        // ID in their diagnostic headers. Correlate the server-side logs by this
        // CorrelationID to follow one Generate end-to-end across client + server logs.
        correlationId?: string,
        // User-facing "Compactness" setting from the visual's formatting
        // pane. Empty string = leave to visual (server rolls a fresh
        // per-request density value); "spacious" / "balanced" / "compact"
        // are deterministic per request. Server reads this in
        // AppendCardinalityAggregationHints to size the cardinality-aware
        // axis threshold (px-per-label divisor).
        compactness?: string,
        // Raw client state for the server-side ModifierResolver. Optional
        // for backwards compatibility — older clients that don't send it
        // get legacy behavior (server uses `modifiers` as-is). See
        // LLMClientHints for the full schema and which modifiers the
        // resolver owns vs which stay client-emitted.
        clientHints?: LLMClientHints
    };

// Result of POST /api/LLMChart/qualify (2026-07-10): the FULL list of chart
// types that MIGHT QUALIFY for the currently-bound field-well shape — the server
// picker's deterministic qualification stage (shape gates + draft strip + time
// prune + small-viewport) with NO top-X trim, NO LLM call, NO credit cost.
// Shown in the "What fits my data?" modal; qualifying names also decorate the
// chart-type dropdowns.
//
// ORDER IS MEANINGFUL (2026-08-07): the list arrives sorted by the picker's own
// deterministic chart-type score, best first — not alphabetically — so the first
// entries are the types the auto-picker most favours for this data. Render it in
// the order given. A trailing group may carry no rank: those qualify on data shape
// but have no auto-pick lane, and are still explicitly choosable.
export type LLMQualifyResult =
    {
        errorMessage?: string,
        charts?: {
            name?: string,
            description?: string,
            // 1 = best fit. Absent for the unranked tail described above.
            rank?: number,
            // 0..100 relative weight, top-ranked chart = 100. Not a probability.
            score?: number,
            // Only on a renderer- or language-scoped qualify; absent when the caller
            // named neither, since the renderer is chosen at generation time.
            renderer?: string,
            language?: string,
        }[],
    }

export type LLMRequestCodeResult =
    {
        errorMessage?: string,
        code?: string,
        version?: number,
        codeSummary?: string,
        // Canonical chart-type name the server landed on. The client accumulates
        // these into its session variety set; a name already in the set means the
        // server cycled back (pool exhausted) → restart the cycle. (design B)
        chartName?: string,
        isServiceError: boolean,
        // Blocked by the per-DEVICE/IP rate limit (not per-key credit exhaustion).
        // The client shows a coherent "daily device limit" message instead of the
        // contradictory "Freemium: 0% used" banner. 2026-06-21.
        isRateLimited?: boolean,
        // Seconds until the per-device window would accept the next generate, when
        // isRateLimited came from that tier and the wait is known (servers from 2026-08-19).
        // The errorMessage already says it in words; this lets a client render a local
        // clock time and know that retrying inside the chain is pointless.
        retryAfterSeconds?: number,
        // A version FETCH found no such version (the input exists without it, or -
        // fetchOnly - no input at all). "Not there YET" for the recovery poll, as a
        // flag rather than a sentence to parse. Servers from 2026-08-19.
        isVersionNotFound?: boolean,
        creditBalanceBefore: number,
        creditCost: number,
        outputHash: string,
        warningMessage?: string,
        // HONOR-THOUGH-UGLY (2026-07-15, server rev 111): true when the explicit
        // chart pick was honored despite failing a legibility cap (too many category
        // values). warningMessage carries the advisory naming the crowded column + a
        // better-fitting alternative; the client force-opens the hover panel over the
        // rendered chart regardless of hover settings so the advice is unmissable.
        advisoryForceShow?: boolean,
        overrideThumbnailUpload: boolean,
        forceClientLogging: boolean,
        language?: string,
        rendererSpecificPayload?: string,
        // Server-signed token "<LLMRequestID>.<sig>" minted on successful
        // licensed generations. The visual persists this as
        // cachedSignedLLMRequestID and replays it on every GetLicenseStatus2
        // call. Null for freemium and for error responses.
        signedLLMRequestID?: string,
        // Encrypted "edit code-behind" deep-link token (AES-GCM blob of the version +
        // account). The hover-panel "Edit code-behind" button opens
        // /account?llmedit=<this>. Null for freemium / error responses (same gate as
        // signedLLMRequestID). Persisted as data.editCodeKey.
        editCodeKey?: string,
        // Freemium state piggyback. Server stamps post-call freemium state
        // (percent used, exhausted, status message) onto the response so the
        // client can fold it into licenseStatus atomically with the credit
        // charge — without this, an overrun on v1 leaves the v2 Generate
        // button enabled against stale cached state until the next periodic
        // getLicenseStatus poll. Null on licensed calls.
        freemiumPercentUsed?: number,
        // Uncapped share-of-cap (the capped twin above maxes at 100). Drives the
        // freemium-overuse watermark, which must distinguish at-cap (100) from
        // far-over-cap (e.g. 475). 2026-06-13.
        freemiumPercentUsedRaw?: number,
        freemiumExhausted?: boolean,
        freemiumStatusMessage?: string,
        // Author-facing reply from the codegen LLM (modify requests only).
        // Surfaces in the visual's hover panel during edit mode so the report
        // author knows whether their change request was honored, partially
        // honored, or declined-with-reason. Empty/null when not a modify
        // request, the LLM omitted the line, or extraction failed.
        userReply?: string,
        userReplyOutcome?: string,  // "fulfilled" | "partial" | "declined"
        // Forward-looking "you could make this better" hint authored by the
        // proofread LLM (// IMPROVE: line). One concise, user-actionable idea —
        // may reference a typical extra dimension/measure the user must add to
        // their data model. Surfaced in the hover panel, set apart (italic +
        // distinct colour). Empty/null when the chart's already a good fit.
        improvementSuggestion?: string,
        // Family-scoped client flag (chartfamilies.json SuppressSelectionGlyph).
        // True for flow/relationship charts (Sankey/Chord/Arc) → the visual
        // skips the cross-filter selection glyph. Persisted into data.suppressGlyph
        // so cached re-renders also honor it. 2026-05-31.
        suppressSelectionGlyph?: boolean,
        // Geo choropleth render contract (geo/choropleth Phase 1, 2026-07-21). When the
        // final chart is a geo type and the shape has a matching geo dimension, the
        // server names that source column (geoColumn) and its resolved geoKind. The
        // render-data builder appends a deterministic __geoIso__ join column (normal-form
        // code via toGeoIso; unmatched → null) beside __rowIdx__ in BOTH the Plotly
        // dataset and the D3 payload, and surfaces the unmatched count via
        // options.geoUnmatched. Persisted so cached re-renders rebuild __geoIso__ too.
        // Null for every non-geo chart.
        geoColumn?: string,
        geoKind?: string,
        // POINT-map render contract (2026-07-25). Sibling of geoColumn/geoKind but a
        // different job: those name ONE column whose values become a polygon join key;
        // these name the SEVERAL columns a COORDINATE can be resolved from, because the
        // cascade is cross-column (a city needs its state to disambiguate). Any subset may
        // be set; the render-data builder appends __geoLat__/__geoLon__ and surfaces what
        // the resolution achieved via options.geoPoint. Null for every non-point chart.
        pointCityColumn?: string,
        pointStateColumn?: string,
        pointZipColumn?: string,
        pointLatColumn?: string,
        pointLonColumn?: string,
        // Also a PLACEMENT of last resort since the country precision tier, not only a
        // narrowing constraint on city matching. The server has named it since 2026-08-02.
        pointCountryColumn?: string,
        // THE ROUTE'S SECOND ENDPOINT (origin-destination flow map, 2026-08-15). The six
        // fields above name the ORIGIN and these name the DESTINATION; the host resolves each
        // through the SAME cascade and appends __geoLatD__/__geoLonD__/__geoPrecisionD__ beside
        // the origin's three. Null on every other chart, which is also how the client knows to
        // bind a route rather than a point.
        destPointCityColumn?: string,
        destPointStateColumn?: string,
        destPointZipColumn?: string,
        destPointLatColumn?: string,
        destPointLonColumn?: string,
        destPointCountryColumn?: string
    };
export type GetLicenseStatusResult =
    {
        errorMessage: string,
        canContinue: boolean,
        creditsLeft?: number,
        warnCredits: boolean,
        priceSheet: string[],
        charts: string[],
        forceClientLogging: boolean,
        forceThumbnails?: boolean,
        exception: boolean,
        freemiumEnabled?: boolean,
        freemiumTrialEndsUtc?: string,
        freemiumPercentUsed?: number,
        // Uncapped share-of-cap (capped twin maxes at 100). Drives the
        // freemium-overuse watermark. 2026-06-13.
        freemiumPercentUsedRaw?: number,
        freemiumWarnAtPercent?: number,
        freemiumExhausted?: boolean,
        freemiumStatusMessage?: string,
        // Per-model cost multipliers keyed by ModelCode (e.g. "AZDS4PRO" → 1.0,
        // "AZGPT5MINI" → 0.25). Baseline = 1.0; the client shows this next to
        // the selected model in the freemium picker (× 0.25 / × 3 / etc.).
        modelCostMultipliers?: Record<string, number>,
        // Per-model human descriptions keyed by ModelCode. Sourced from
        // LLMModel.LongDesc; rendered as an italicised one-liner under the
        // freemium picker so users understand the trade-offs of each model.
        modelDescriptions?: Record<string, string>,
        // Per-model display names keyed by ModelCode, sourced from
        // LLMModel.ModelName, built from the SAME active-model filter as
        // modelCostMultipliers. This IS the server's authoritative active set —
        // the client builds the freemium picker from these keys so DB
        // activation/expiry/ExcludeFreemium changes auto-reflect on every
        // client without a rebuild. The client prefers its own curated label
        // when it has one for the code, falling back to this server name.
        modelDisplayNames?: Record<string, string>,
        // Account-level model override (Account.OverrideLLMModelID resolved
        // to ModelCode). Present only for licensed users whose account has
        // pinned a model. When present, the client locks the picker to this
        // code and surfaces a note that the choice is account-controlled.
        overrideModelCode?: string,
        // Live trial offer from the server's "sitetrial" Product (UseCredits /
        // DaysDuration). Drives the licensed-setup help text; undefined when absent.
        trialUseCredits?: number,
        trialDaysDuration?: number,
        // Latest PUBLISHED visual version (Control.PublishedVersion) + whether it's a
        // pre-release. The landing page shows a "newer version available" notice when the
        // running BUILD_VERSION is older than this. Undefined when the server didn't send it.
        latestVersion?: string,
        latestVersionIsPreview?: boolean,
        // ModelCode of the catalog's default (LLMModel.IsDefault=1) row,
        // pre-filtered to active and within its effective window. The
        // client uses this to order the freemium picker so the default
        // appears first and is the natural fallback when a persisted
        // choice has expired. Null when no active default exists.
        defaultModelCode?: string,
        // True when the active license is a trial (Product.ProductCode ==
        // "sitetrial"). Reported for diagnostics; the actual post-expiry
        // render block keys on `everPaid` (account-wide history) rather
        // than `isTrial` (current license only).
        isTrial?: boolean,
        // True when this account has EVER held a non-sitetrial paid
        // AccountProduct (active or historical). When canContinue=false AND
        // everPaid===false, the visual blocks ALL cached rendering — no
        // unlock carve-out. Trial-only accounts never get eternal-cache
        // access on their unlocked versions; only accounts that ever paid
        // for a real license retain the unlocked-after-expiry benefit.
        everPaid?: boolean,
        // True when the visual sent a valid cachedSignedLLMRequestID AND the
        // referenced LLMRequest row is owned by this account AND has
        // ClonedFromLLMRequestID NOT NULL (= paid-to-unlock via the
        // LLMHISTUNLOCK flow). Only consulted when canContinue=false AND
        // isTrial=false (the "paid expired" gate). NEVER persist this:
        // it's a fresh server decision per licenseStatus call so an
        // attacker can't store a stale "true" in the pbip and bypass.
        cachedVersionUnlocked?: boolean,
        // Deterministic hash of the CURRENT server-side code for the version our
        // cachedSignedLLMRequestID points to (unlocked clones only). On load the
        // visual compares it to its stored cachedOutputHash and, if different, re-pulls
        // the code (editSync) so an in-place history-editor edit reaches the report.
        cachedVersionOutputHash?: string,
        // DISTRIBUTION PIN (2026-07-03). True when the referenced unlocked clone
        // has been pinned for distribution/sharing (LLMRequest.DistributionLockedDate).
        // On an AUTHORITATIVE response the visual runs the one-way pin transition:
        // persist pin+unlock markers, re-sign the cached code with pinned=true, then
        // STRIP license/secret/freemium credentials from the report in the same batch.
        // Like cachedVersionUnlocked this is a fresh server decision — but unlike it,
        // the pin DOES persist client-side (the self-signed pin marker): after the
        // strip there are no credentials left to resolve the account with, so the
        // pinned visual must be self-sufficient offline forever.
        cachedVersionPinned?: boolean
    }
