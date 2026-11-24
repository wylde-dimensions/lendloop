# Running LendLoop in production

A short note on what I'd change before real neighbors' data goes in. It assumes AWS, since that's where the rest of a B2B stack would usually live.

## Hosting

- **Convex:** Convex Cloud, a production deployment, deployed from CI with `npx convex deploy`. The typed env in `convex.config.ts` refuses a deploy that's missing a variable. If data residency or policy requires self-hosting, run the backend on **ECS Fargate** with **RDS Postgres** (`POSTGRES_URL`) and **S3** for storage, behind an ALB.
- **Next.js:** Vercel, or AWS (Amplify, or OpenNext on Lambda + CloudFront). It's stateless and holds only the Clerk keys.
- **n8n:** **ECS Fargate in queue mode**:
  - Main plus webhook processors plus workers, on **RDS Postgres** and **ElastiCache Redis**, instead of one container on SQLite.
  - Task runners stay external (sidecars), as they are here.
  - Pin the image version and upgrade deliberately; n8n 3.0 removes internal runner mode, which this setup already avoids.
- **Email:** **Amazon SES** with SPF, DKIM and DMARC on a sending subdomain. Bounce and complaint events go back into Convex so a dead address stops getting mail. Mailpit is local only.

## Network and access

- **Only the webhook path is public.** Expose just `/webhook/lendloop/*` through ALB/CloudFront with **WAF** rate rules.
- **The n8n editor is private** (VPN or SSO, never public), with n8n SSO/RBAC for operators.
- **Convex → n8n can stay on private networking** when both are self-hosted. With Convex Cloud, the HMAC signature and timestamp window are the gate.
- **Production Clerk instance** on your own domain, with MFA available. Use **Clerk Organizations** for B2B tenancy and roles. Today's single global `admin` would become per-organization roles, still enforced in Convex.

## Secrets

- **AWS Secrets Manager** (or SSM Parameter Store) is the source. ECS injects secrets into containers at start; nothing is in images or files.
- **n8n credentials:** use n8n's external-secrets integration with Secrets Manager. Otherwise CI provisions them through the n8n API, as `n8n/bootstrap` does locally.
- **Rotation:** rotate the two signing secrets on a schedule using the `*_PREVIOUS` overlap the code already supports. Rotate `N8N_ENCRYPTION_KEY` only with a re-encrypt plan.

## Reliability

- **Close the notification dedupe window.** Move it into Convex: n8n claims an `eventId` before sending, like reminders. Or use a shared store (Redis or n8n Data Tables) with an atomic insert.
- **Alert on dead letters.** A failed notification or an open incident should page someone. Wire them to Slack or PagerDuty instead of the ops inbox alone, and alert when the outbox is backed up.
- **Paginate the overdue batch** (`hasMore` is already returned), and add an index on reminders if volume grows.
- **Backups and drills.** Convex snapshot exports, or RDS automated backups with point-in-time recovery. Restore-test them.

## Observability

- **Datadog** for logs, metrics and alerts. Convex log streaming ships the structured JSON logs the functions already emit (`notification.delivered`, `notification.dead_lettered`, `automation.request_rejected`…). n8n logs and metrics (`N8N_METRICS=true`) go there too, through the Datadog agent on ECS.
- **Sentry** on the Next.js client and server, scrubbed of personal data.
- **CloudTrail** for every AWS API call (secret reads, IAM changes), alongside the app's own audit log.

## Privacy and compliance

- **Data retention:**
  - Keep n8n's error-execution retention short.
  - Purge `outbox` and `reminders` rows after a set period; keep the audit log longer, since it holds ids only.
  - Handle account deletion through Clerk's `user.deleted` webhook (verified with Svix) → erase or anonymize that user in Convex.
- **Vendor agreements:** a DPA with each processor (Clerk, Convex, AWS, Datadog, Sentry). For regulated data such as health, confirm a BAA (or equivalent) with each vendor before any of it flows. LendLoop holds none.
- **Before launch:** a security review, dependency and image scanning in CI (Dependabot, Trivy), and a penetration test of the public webhook and auth flows.

## Product polish I'd add next

- **In-app notifications and preferences:** email on or off per event, and quiet hours.
- **Pickup coordination:** a message thread per loan instead of sharing phone numbers.
- **Accessibility:** an audit (axe in CI) and Playwright end-to-end tests with Clerk testing tokens.
