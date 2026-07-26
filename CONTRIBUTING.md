# Contributing

Issues and pull requests are welcome. This is a small project maintained alongside a
commercial product, so please open an issue before starting anything large — it may
already be constrained by something on the closed side that is not obvious from here.

## Getting set up

```bash
npm install     # workspaces: both packages, linked
npm run build   # esbuild bundles + .d.ts for each package
npm test        # vitest across both, plus the repo-level checks in tests/
```

`npm run verify` runs build, typecheck and tests together — the same sequence CI runs.

Build before typechecking. `chart-host` resolves `@bicharts/shape-core` through the
workspace symlink, which reaches `package.json` `main` → `dist`; with no build there
are no types to find.

## Two things that will bite you

**Tests import source; consumers import the tarball.** The suite can be entirely green
while the published package is broken — this has happened twice, once with a tarball
that contained no `shape-core` at all, and once with a `.d.ts` that imported a package
consumers never install. If you touch `build.mjs`, `exports`, or `package.json`, the
`packaged` CI job is the one to watch. It packs, installs into a clean project outside
the repo, imports, and typechecks with `skipLibCheck` **off**.

**Map geometry is lazy on purpose.** Roughly 1.3 MB of it loads through dynamic
`import()` in `geoLazy.ts`, because most charts are not maps. A top-level `import` of a
geo asset is the easy way to undo that, and it looks harmless in review, so
`scripts/checkEagerSize.mjs` walks the static-import closure and fails the build.

## What we look for in a change

- **A test that fails without the fix.** Then break the fix and confirm the test goes
  red — a test that cannot fail is worse than no test, because it reads as coverage.
- **Comments that say why, not what.** The code in this repo is unusually commented
  because much of it encodes a hard-won reason. Keep that.
- **No new runtime dependencies in `chart-host`** without discussion. Installing one
  package and being done is a promise the README makes, and every dependency added here
  lands in every consumer's bundle and licence audit.

## Licensing

Contributions are accepted under [Apache-2.0](LICENSE), the licence of this repository.
There is no CLA.

If you add or update embedded reference data, update [NOTICE](NOTICE) in the same
change. The GeoNames data is **CC BY 4.0** — attribution is a condition of the licence,
not a courtesy, and it is inherited by everyone who bundles this package. `tests/licensing.test.ts`
enforces the parts of that which can be enforced mechanically.
