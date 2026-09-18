# Upstream fixtures

The three `generators/*.py` files are copied **without modification** from
[Kineviz/spanner-omni-kineviz-examples](https://github.com/Kineviz/spanner-omni-kineviz-examples)
at commit `fb395d58514836043b5daba0ea5e47448802864a`:

| Local file | Upstream path |
|---|---|
| `generators/fraud-rings.py` | `demos/fraud-rings/data/generate.py` |
| `generators/edge-fleet.py` | `demos/edge-fleet/data/generate.py` |
| `generators/paysim-schemaless.py` | `demos/paysim-schemaless/data/generate.py` |

Copyright (c) 2026 Kineviz, Inc. Used under the [MIT license](../LICENSE).
Their comments and interchange manifest still mention Spanner because they are
auditable upstream fixtures. They run only Python's standard library and contact
no database. `src/data.ts` translates their CSV output into AGE vertices, edges,
and typed properties. No Spanner binary, proxy, account, or service is used.
