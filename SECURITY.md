# Security policy

## Reporting a vulnerability

Please report privately, not as a public issue: open a
[security advisory](https://github.com/codexguy/bicharts/security/advisories/new),
or email **<info@bizintelligencechampions.com>**.

Expect an acknowledgement within a few business days. This is a small project, not a
funded security team — an honest expectation is better than a promised SLA nobody meets.

## What these packages do and do not do

Worth understanding before you decide what counts as a vulnerability here.

**`@bicharts/chart-host` executes code you give it.** `render(container, code, …)`
compiles a JavaScript string with `new Function` and runs it in your page, with full
access to that page. That is the design: the chart *is* source you own and commit. It
is not a sandbox and does not try to be one.

The security boundary is therefore **where the chart code comes from**, and it is yours
to hold:

- Chart code you generated and committed to your repository is as trustworthy as the
  rest of your repository, and reviewable in the same way. This is the intended use.
- Chart code fetched at run time from a server, or built from user input, is **remote
  code execution by design**. Do not do this with untrusted input.

Reports that `new Function` runs the code passed to it are not vulnerabilities. Reports
that chart code can escape a boundary this package *claims* to enforce, or that
*data* (rather than code) can reach an execution path, are — please send those.

**Data does not leave the page.** Neither package makes network requests at run time.
Geographic reference data is embedded, not fetched. There is no telemetry, no API key,
and no call home. If you observe otherwise, that is a bug worth reporting.

## Scope

In scope: anything in this repository, and the published `@bicharts/*` packages.

Out of scope: the BIC generation service and the BIC Power BI visual, which are
separate and closed-source. Report those to the email above rather than here.
