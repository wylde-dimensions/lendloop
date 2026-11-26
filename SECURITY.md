# Security policy

LendLoop is a take-home exercise, not a live service: it runs only on the machine of whoever starts it, with throwaway secrets that `npm run setup` generates. There is no production deployment to attack. Reports about the code are still welcome.

## Reporting a vulnerability

Please report privately, through GitHub: the repository's **Security** tab → **Report a vulnerability**. Don't open a public issue for anything exploitable.

Helpful to include: what an attacker can do, the steps or a proof of concept, and the commit you tested. You'll get an acknowledgement within a few days, and a fix or an explanation of why it isn't one.

## In scope

- Authorization: anything that lets one person read or change another's listings, loans or data, or reach an admin function without the admin role.
- The n8n ↔ Convex integration: forging, replaying or tampering with a signed request, or making a retry send a duplicate.
- Anything that leaks personal data (emails, names) beyond what the README's data-minimization rules allow.
- Anything that lets the app, its containers or its install step affect the machine running it.

## Out of scope

- Findings that require the deploy key, the n8n owner password or the generated `docker/.env`. These are the operator's secrets.
- Clerk, Convex or n8n vulnerabilities themselves. Please report those to their maintainers.

How the app defends itself is documented in [README → Security and data minimization](README.md#security-and-data-minimization). What would change before real data goes in is in [PRODUCTION.md](PRODUCTION.md).
