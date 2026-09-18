# Security

These are local examples, not a hardened production deployment. PostgreSQL binds
to loopback; Kafka is available only on the Compose network. Generated passwords
live in `.env` with owner-only permissions. The proxy is also published only on
loopback. Its API key protects queries; a separate admin password protects
registration and configuration. Neither is printed by the CLI. Never commit `.env` or publish its
values. The Kineviz reader receives SELECT grants and defaults to read-only
transactions; the loader and sink use the local administrator account.

AGE 1.6's Cypher `SET` path can bypass the session's read-only preference. The
proxy therefore also rejects mutation clauses and procedure calls before
execution. It accepts Cypher, not arbitrary SQL. The optional raw SQL panel does
not apply this proxy guard; use the proxy for the documented read-only demo
connection. Keep this local demo away from untrusted queries and privileged
database functions on a production server.

The supplied compose configuration does not enable TLS, high availability, or
backups. A production deployment needs its own network controls, secret
management, restricted ingestion role, backups, monitoring, and patch process.

Do not put sensitive data into public issues. Report security concerns through
the repository's GitHub private vulnerability reporting interface when enabled,
or contact the maintainers through an existing private channel.
