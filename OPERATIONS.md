# Research Assistant operations

## Deployment variables

Set these on the **Convex Cloud deployment**, not in web environment variables:

- `SITE_URL`: Better Auth web origin.
- `GATEWAY_MODEL_ID`: current implementation prices only `openai/gpt-5-mini`.
- `EXA_API_KEY`: Exa search API key.
- `BUDGET_MONTHLY_USD_DEFAULT`: positive USD amount; calls fail closed without it.
- `ADMIN_EMAIL`: exactly one administrator; case-insensitive match against the authenticated identity email.
- `GATEWAY_EMBEDDING_MODEL`: default `openai/text-embedding-3-small`. Only the default embedding model is priced.
- `GATEWAY_EMBEDDING_DIMS`: `1536` if configured; vector index dimensions are fixed in the schema.
- Optional: `GATEWAY_COMPARISON_MODEL_IDS` (comma-separated), `BUDGET_ALERT_THRESHOLDS` (default `0.8,1.0`), `RATE_LIMIT_RESEARCH_PER_HOUR` (default `10`), `RATE_LIMIT_CHAT_PER_MINUTE` (default `30`), `RESEARCH_MAX_TASKS` (max 3), `MAX_REPORT_TOKENS` (max 8000), `MAX_DOCS_PER_THREAD`, `MAX_PDF_BYTES`, and `MAX_PDF_PAGES`.
- For any model besides the two priced defaults, set `GATEWAY_MODEL_PRICES_JSON` to a JSON map of model IDs to USD-per-million-token rates, for example `{"provider/model":{"input":1,"output":3}}`. Unknown models fail closed, including comparison models.

After configuring, deploy with `pnpm run dev:server` for cloud dev. Check `pnpm run lint`, `pnpm run check-types`, `pnpm --filter @convex-research-assistant/backend exec tsc -p convex/tsconfig.json --noEmit`, `pnpm --filter @convex-research-assistant/backend test`, and `pnpm run build`.

## Monitoring and response

- `budgetAccounts` has one row per user and UTC calendar month. The admission mutation checks `spentNanos + reservedNanos + estimate` transactionally. `budgetReservations` is the audit of holds. A five-minute cron settles holds older than fifteen minutes as the full held amount, preserving the cap when usage is unknown.
- `budgetAlerts` records the first crossing of each threshold in each period. Inspect this table and `usageLedger` for investigation. There is **no email alert delivery**; trigger notifications separately if required.
- `/admin` is a backend-gated, minimal per-user spend and increase page. Set `ADMIN_EMAIL`. For a one-off increase, locate the user ID in the list, enter a dollar amount and reason, and check `budgetIncreases` for its record. Increases apply only to the current UTC month.
- Users can compare a recently logged model request in the dashboard. `GATEWAY_COMPARISON_MODEL_IDS` is an allowlist; a comparison is budgeted to the original user. The published budget component keeps request content only briefly by default; the admin can set retention using `admin.setAuditRetention` (1–30 days) from the Convex function runner.
- Cancel a research run in its timeline; completed reports and critiques remain. A failed workflow can be restarted from the timeline. A new research run is rejected while another is active for that session.
- Deleting a session cancels active workflows, schedules batched content deletion, and retains ledger/usage rows for accounting. The Agent component deletes its thread asynchronously.

## Current component and accounting limits

The npm-published `@convex-dev/ai-budget@0.0.2-alpha.0` does **not** have the monthly-limit, exact worst-case output reservation, or built-in dashboard APIs described in its current upstream README. This app adds a monthly reservation ledger and an admin page; the component records gateway model calls separately. Prices are explicitly defined in `convex/budget.ts` and unknown models fail closed. The application ledger currently calculates actual cost from token counts and configured prices, not the gateway's authoritative per-request bill. Consequently, the strict “never exceed the user's real bill” guarantee in `SPEC.md` requires a component version supporting authoritative gateway cost and true maximum reservations, plus deployment testing. Do not claim that acceptance criterion based solely on typechecks.

Action retries can consume another reservation and charge again if a provider call succeeded but its artifact commit failed. Verify the real deployment's usage and ledger before relying on cost figures. There is no OCR for image-only PDFs. Email verification is intentionally disabled (`requireEmailVerification: false` in `convex/auth.ts`) so any signed-in account can start model calls; re-enable it and wire an email provider if throwaway accounts become a budget concern.
