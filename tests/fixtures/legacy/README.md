# Pinned legacy behavior evidence, not a runtime dependency

These intentionally narrow fixtures were extracted from **the exact original sources** in
`VahramSargsyan/vbos-app` at commit `e17643a0c399d859abe85c4057a7ec732ac25526`.
Each fixture includes the original Git blob SHA-1 and file name.

- `CapitalService.excerpts.js.txt` contains **only four verbatim historical Capital functions**, needed by the tests to execute the original waterfall and movement-effect algorithms against current Clean implementations. Do not replace with a mock that calls Clean itself.
- The other five `*.snippets.txt` files contain **only exact lines** bearing pre-existing test assertions. They preserve historical marker checks but **do not prove fresh parity** with a later changing old repository.
- The fixtures contain no exported customer records, credentials, private database values, or complete legacy modules.
- When intentionally changing a legacy contract, re-check its original exact file+commit+blob through authorized read access, derive new fixture from the source and record the review in the migration Build Packet. Never silently rebaseline failing comparisons.
- Full Node unit tests must pass from a standalone checkout of this repository; tests must not read ancestor directories or rely on the private vbos-app checkout.
- These are TEST ONLY. No old Google scripts are run in Clean runtime; no PROD or financial authority is changed.
