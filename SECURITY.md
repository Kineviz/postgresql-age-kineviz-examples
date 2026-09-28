# Security

These are local examples, not a hardened production deployment. PostgreSQL binds
to loopback; Kafka is available only on the Compose network. Generated passwords
live in `.env` with owner-only permissions and are never printed by the CLI.
Never commit `.env` or publish its values.

The native visualization login `kineviz_native_reader` inherits SELECT grants
from `kineviz_reader`, defaults to read-only transactions and has no superuser,
role-management or database-creation privileges. `connect up` generates a
separate prefixed password for compatibility with Kineviz's credential handling.
It preserves the previous SQL/proxy login and all existing passwords.

AGE 1.6's Cypher `SET` path can bypass the session's read-only preference. Keep
**database writes disabled** in the Kineviz project: the native connector checks
both ordinary Cypher and the Cypher body of a SQL wrapper. A PostgreSQL read-only
session preference alone is not an AGE write boundary. Do not use this demo as
an isolation boundary for untrusted queries or production data. The loader and
sink use the local administrator account; never enter that account in Kineviz.

The supplied Compose configuration does not enable TLS, high availability, or
backups. A production deployment needs its own network controls, secret
management, restricted ingestion role, backups, monitoring, and patch process.
Use an administrator-managed AGE preload for reader sessions; do not grant
superuser just to allow `LOAD 'age'`.

The optional legacy proxy remains loopback-only with separate API and admin keys.
Native setup never starts it, rotates its keys, or removes its configuration.
Stop it only when no existing project needs it. See [migration](connect/README.md).

Do not put sensitive data into public issues. Report security concerns through
the repository's GitHub private vulnerability reporting interface when enabled,
or contact the maintainers through an existing private channel.
