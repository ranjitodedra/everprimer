# Vendored third-party libraries

Per [ADR-003](../../../Docs/artifact-library/decisions/ADR-003-vendored-libraries.md),
library artifacts never load code from a public CDN at runtime. The Stage 3
importer rewrites allowlisted CDN URLs to our artifact origin, which (in
Stage 4) will serve files out of this directory under
`/v/{package}@{version}/{path}`.

## Why files aren't committed

Three.js alone is ~1.4 MB per minor version. Checking vendored tarballs into
the repo would bloat clones and make PR diffs unreadable. Instead,
[`lock.json`](./lock.json) is the source of truth: it lists each
`{ package, version, license, tarball, tarballIntegrity, files }`. The real
bytes live in `packages/library/vendor/files/` (git-ignored) and are
materialized on demand.

## Syncing

```sh
pnpm --filter @eco/library vendor:sync
```

The script resolves each tarball from the npm registry, verifies its
integrity against `tarballIntegrity` (populated on first successful sync),
extracts only the paths declared under `files`, and writes them to
`files/{package}@{version}/`. First run has no integrity to check against;
subsequent runs are deterministic.

## Adding a library

1. The authoring brief (Stage 7) tells external AIs which libraries exist. Do
   not accept artifact uploads that pull in an unknown library.
2. If a seed artifact genuinely needs a new library, add it to `lock.json`
   with its exact version and license, run `vendor:sync` once to populate
   `tarballIntegrity`, and commit the lock change (not the files).
3. Flag anything whose license is not MIT/ISC/BSD/Apache-2.0 for legal
   review before Stage 13 ships the public API.
