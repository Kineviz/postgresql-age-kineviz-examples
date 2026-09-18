# Security

These are local examples, not a hardened production deployment. PostgreSQL binds
to loopback; Kafka is available only on the Compose network. Generated passwords
live in `.env` with owner-only permissions. Never commit `.env` or publish its
values. The Kineviz reader receives SELECT grants and defaults to read-only
transactions; the loader and sink use the local administrator account.

The supplied compose configuration does not enable TLS, high availability, or
backups. A production deployment needs its own network controls, secret
management, restricted ingestion role, backups, monitoring, and patch process.

Do not put sensitive data into public issues. Report security concerns through
the repository's GitHub private vulnerability reporting interface when enabled,
or contact the maintainers through an existing private channel.
