# Handover documentation

This folder is the **client handover package** for `iovibe-backend`. It
is written for a technical team taking the project over — assume you can read
TypeScript and run a terminal, assume nothing about this specific codebase.

It complements, not replaces, the docs at the repo root:

| Root doc | What's in it | Read this `docs/` set instead when you want... |
|---|---|---|
| [../README.md](../README.md) | Quick start, scripts, deploy steps, current status | ...to actually run the thing today |
| [../ARCHITECTURE.md](../ARCHITECTURE.md) | Stack decisions, layering rules, the full endpoint map, data-model conventions | ...the *why* behind a pattern before changing it |
| [../INTEGRATIONS.md](../INTEGRATIONS.md) | Every third-party key: what it's for, how to get it | ...to provision a new environment |
| [../DEFERRED-DECISIONS.md](../DEFERRED-DECISIONS.md) | The two big infra decisions not yet made (HLS transcode, SFU), costed | ...to plan what's next |
| [../CLAUDE.md](../CLAUDE.md) | Engineering standard, how to add a feature, test conventions | ...before writing your first change |

This folder exists because those docs answer "what did they build and why" —
they don't draw the database, walk a request end-to-end, or tell you what to
do on day one of owning this system. That's what's here:

| Doc | What's in it |
|---|---|
| [01-system-overview.md](01-system-overview.md) | The product in plain language, how the two repos fit together, one architecture diagram |
| [02-database-schema.md](02-database-schema.md) | Full ER diagram + every table, column, constraint, and index |
| [03-api-reference.md](03-api-reference.md) | The response envelope + error codes, then every endpoint: method, path, auth, request/response shape, one table per domain |
| [04-flows.md](04-flows.md) | Sequence diagrams for the flows that span multiple services: auth, checkout, video publish, chat, calls, moderation |
| [05-deployment-and-operations.md](05-deployment-and-operations.md) | How this runs in production today, how to deploy a change, what to watch, what to do when it breaks |
| [06-security.md](06-security.md) | The auth/session model, secrets, rate limiting, what's in scope for a security review |
| [07-handover-checklist.md](07-handover-checklist.md) | **Start here if you're taking this over.** Every account, credential, and piece of access that needs to change hands, plus open decisions |
| [08-glossary.md](08-glossary.md) | Domain terms used inconsistently loosely in conversation, defined precisely once |

## Reading order for a new team member

1. [07-handover-checklist.md](07-handover-checklist.md) — what you now own and what's still missing
2. [01-system-overview.md](01-system-overview.md) — the shape of the whole system
3. [../README.md](../README.md) — get it running locally
4. [02-database-schema.md](02-database-schema.md) + [03-api-reference.md](03-api-reference.md) — the contract
5. [04-flows.md](04-flows.md) — how the pieces cooperate on the flows that matter most (money, auth)
6. [../ARCHITECTURE.md](../ARCHITECTURE.md) — the design rationale, once you have the shape in your head
7. [05-deployment-and-operations.md](05-deployment-and-operations.md) and [06-security.md](06-security.md) — before you touch production

Last updated: 2026-07-26, against the codebase as of the same date. Update this
folder in the same change that changes the contract it documents — a stale
handover doc is worse than none, because it's trusted.
