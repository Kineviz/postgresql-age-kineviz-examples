# Verification record

Verified locally on **2026-09-18**, using Docker Desktop on ARM64:

- PostgreSQL **16.10**, Apache AGE extension **1.6.0**.
- Official AGE multi-architecture manifest
  `sha256:16aa423d20a31aed36a3313244bf7aa00731325862f20ed584510e381f2feaed`.
- Apache Kafka **3.9.1** and Node.js **22.22.3** in the replay containers.
- Upstream fixture commit `fb395d58514836043b5daba0ea5e47448802864a`.

| Check | Observed result |
|---|---|
| Fraud-rings | 620 vertices, 3,319 edges; two ring devices and an excluded innocent family |
| Edge-fleet | 954 vertices, 2,012 edges; gateway concentration and dependency cascade |
| PaySim | 13,666 vertices, 25,266 edges; seven labels and family exclusion |
| SQL files | All 12 analytical and 12 canvas queries executed and returned results |
| Repeated setup | Existing graph counts preserved |
| CSV exports | Counts match; every edge endpoint exists in exported nodes |
| Reader connection | Single SELECT with real username/password succeeds without separate session setup |
| Reader writes | SQL and Cypher writes rejected; disabling the role's read-only default still leaves table writes denied |
| Failed setup transaction | New graph creation rolled back with the transaction |
| Replay MERGE | Applying one transaction twice produces one vertex and two edges |
| Kafka full replay | 12,033 unique transactions landed; every vertex, edge, endpoint, and property matches the batch fixture |
| Kafka duplicate replay | 24,066 delivered events, 12,033 unique transactions; consumer lag 0 |
| TypeScript / unit checks | Type check and all four test groups pass |

Run the same checks with:

```bash
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:integration
npm run test:stream
```

The integration suite exercises PostgreSQL sessions equivalent to the Kineviz SQL
backend and validates the exact query files. **The Kineviz desktop UI and its
Mapping Editor were not exercised in this validation.** Mapping instructions
are provided separately. The original Spanner project archive and dashboard are
not included as AGE-compatible assets.

Local evidence above is ARM64. The GitHub Actions workflow also runs these checks
on Ubuntu; consult its result for the committed revision rather than assuming
that a local pass proves every platform.
