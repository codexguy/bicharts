// THE SERVER'S NAME WORDS - the words the chart engine's own readers take from a column NAME to find a shape that
// shape-core does not read itself:
//
// - TARGET_NAME_WORDS: the actual-against-target pair. A measure is the BENCHMARK (`Revenue Target`), the ACTUAL
//   (`Actual Revenue`), or a comparison already made, so neither half (`Budget Variance`, `Quota Attainment`).
// - REP_NAME_WORDS: the territory planner's rep, the category that names a person (`Sales Rep`, `Account Manager`).
// - SURVIVAL_ROLE_NAME_WORDS: the retention roles. Which date STARTS a life and which ENDS it, which is the LAST
//   activity or the AS OF date, which number is a tenure, which flag is the event and which column an event log's kind.
//
// WHAT READS THEM HERE. A stand-in whose names are masked (obfuscate's `names: "mask"`) keeps every word in these
// sets, as it keeps the words shape-core's own detectors read, so the stand-in is offered the charts the real table
// is. Nothing else in shape-core reads them.
//
// ONLY THE WORDS THAT FIND THE SHAPE. A server reader also holds words that only rank or refuse a column (the
// territory planner's load and account words, retention's never-a-role dates and its count and value words); they are
// left out, because keeping them would keep common words (Revenue, Order, Code) in every masked name.
//
// THE SERVER'S LISTS ARE THE SOURCE. Each set is the union of named English word lists in one server reader, a
// two-word form split into its words; the server's tests compare each block below with them word for word, so an edit
// on either side fails there until the other side follows. Lower case, matched folded (see isServerNameWord). Keep the
// parity markers intact, and put no quoted text inside a block after its `=`.

import { foldName } from "../nameReader";

/* parity:target-name-words:begin */
export const TARGET_NAME_WORDS: ReadonlySet<string> = new Set([
    // reference words: the measure is the benchmark
    "target", "targets", "goal", "goals", "benchmark", "benchmarks", "quota", "quotas", "budget", "budgeted", "plan",
    "planned", "forecast", "forecasted", "projected", "threshold", "baseline", "sla", "objective", "objectives", "expected",
    "expectation", "standard", "par", "limit", "cap", "ceiling", "floor", "commitment", "committed",
    // actual words: the measure is the actual half
    "actual", "actuals", "current", "achieved", "attained", "realized", "realised", "ytd",
    // difference words: a comparison already made
    "variance", "var", "delta", "diff", "dif", "difference", "change", "chg", "gap", "vs", "versus", "deviation", "over",
    "under", "overrun", "shortfall", "surplus", "remaining", "minus", "error", "bias", "above", "below", "against",
    // remainder words: what is left of the reference
    "available", "left", "unused", "unspent",
    // result and metric nouns: a rate taken of the reference
    "compliance", "attainment", "achievement", "adherence", "fulfilment", "fulfillment", "realisation", "realization",
    "breach", "breaches", "usage", "consumption",
    "coverage", "utilisation", "utilization", "accuracy", "availability", "performance", "occupancy", "uptime",
]);
/* parity:target-name-words:end */

/* parity:rep-name-words:begin */
export const REP_NAME_WORDS: ReadonlySet<string> = new Set([
    // strong words
    "rep", "reps", "representative", "representatives", "salesperson", "salespeople", "salesrep", "seller", "sellers",
    "owner", "owners", "agent", "agents", "ae", "vendedor", "vendedora", "vendedores", "comercial", "comerciales",
    "commercial", "commerciaux", "vertriebsmitarbeiter", "verkaufer", "verkaeufer", "technician", "technicians", "engineer",
    "engineers", "driver", "drivers", "courier", "couriers", "inspector", "inspectors", "installer", "installers",
    "merchandiser", "merchandisers", "tecnico", "tecnicos",
    // the words of the strong two-word forms (account manager, sales manager, key account, ...)
    "account", "manager", "executive", "territory", "sales", "key", "district", "branch", "area", "field",
    // weak words
    "managers", "territories", "assigned", "assignee",
]);
/* parity:rep-name-words:end */

/* parity:survival-role-name-words:begin */
export const SURVIVAL_ROLE_NAME_WORDS: ReadonlySet<string> = new Set([
    // a start date
    "start", "started", "starts", "startdate", "signup", "signups", "signed", "sign", "joined", "join", "joining", "created",
    "creation", "acquired", "acquisition", "activated", "activation", "subscribed", "onboarded", "onboarding", "opened",
    "open", "since", "first", "hire", "hired", "enrolled", "enrollment", "begin", "began", "connected", "connection",
    "connect", "registered", "registration", "admitted", "admission", "issued", "issue", "inception", "commenced",
    "commencement",
    // an end date
    "end", "ended", "ends", "enddate", "churn", "churned", "cancel", "cancelled", "canceled", "cancellation", "closed",
    "close", "lost", "left", "leave", "terminated", "termination", "expired", "expiry", "exit", "exited", "lapsed",
    "deactivated", "deactivation", "unsubscribed", "stopped", "stop", "disconnected", "disconnection", "disconnect",
    "resigned", "resignation", "separated", "separation", "discharged", "discharge", "withdrawn", "withdrawal", "withdrew",
    "offboarded", "offboarding", "departed", "departure", "quit", "lapse",
    // the last activity, and the as-of date (the words as and of are read as a pair)
    "last", "latest", "recent", "lastactive", "lastseen", "lastlogin",
    "snapshot", "asof", "extract", "extracted", "export", "exported", "as", "of",
    // a tenure, the event (with the end words above), an event log's kind
    "tenure", "lifetime", "duration", "months", "days", "weeks", "age",
    "attrition", "attrited", "status", "active", "retained",
    "event", "events", "action", "actions", "activity", "type", "kind",
]);
/* parity:survival-role-name-words:end */

/** True when a name word (one letter-and-digit run) is in one of the server's name-word sets, matched folded and
 *  case-free (`Verkäufer` reads as `verkaufer`). */
export function isServerNameWord(word: string): boolean {
    const w = foldName(String(word ?? "").normalize("NFC")).toLowerCase();
    return w.length > 0 && (TARGET_NAME_WORDS.has(w) || REP_NAME_WORDS.has(w) || SURVIVAL_ROLE_NAME_WORDS.has(w));
}
