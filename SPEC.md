# Spec: Convex Research Assistant

This document is the implementation specification for the project described in
`README.md`. It resolves the ambiguities in the README roadmap with concrete
decisions and is the source of truth for implementation. Where this document and
`README.md` disagree, this document wins.

## 1. Purpose

Build a small, self-hosted, multi-agent research assistant that demonstrates the
major capabilities of the Convex Agent component in one vertical product: users
sign in, create research sessions, upload documents, ask questions, and receive
a streamed, cited report produced by cooperating agents under a hard per-user
spending cap.

The project is learning-oriented. Correctness of the cost-control loop and the
durability of the workflow matter more than breadth of integrations or UI polish.

## 2. Goals

- Demonstrate threads/messages, streaming, tool calls, RAG/vector search, file
  storage, multi-agent coordination, durable workflows, usage tracking, cost
  accounting, and rate/budget limits in one app.
- Make every model and embedding call go through the Convex AI Gateway and be
  attributed to a user and a feature.
- Never allow a request to exceed a user's budget.
- Keep all provider credentials out of the frontend and repository.

## 3. Non-Goals (explicitly out of scope)

- Social/OAuth or magic-link login (email + password only).
- Payments, paid plans, or self-serve billing.
- Multi-tenant orgs, teams, roles, or invitations.
- Public shareable report links or collaborative editing.
- Mobile/native app or PWA offline mode.
- Model fine-tuning or custom training.
- Spreadsheet/bulk export of usage analytics.
- Local or self-hosted Convex model execution (gateway requires Convex Cloud).

## 4. Architecture Overview

- **Frontend**: `apps/web`, TanStack Start + TanStack Query + Convex React.
- **Backend**: `packages/backend/convex`, Convex functions, schema, HTTP routes.
- **Agents**: `@convex-dev/agent` for assistant agents, threads, messages,
  streaming, and tool calls.
- **Workflow**: `@convex-dev/workflow` for durable, recoverable plan → research
  → write → verify steps.
- **Cost control**: Convex AI Gateway + the `ai-budget` component, plus
  `@convex-dev/rate-limiter` for frequency limits.
- **RAG**: Convex file storage for PDFs, vector index + full-text index on chunks,
  hybrid retrieval with reciprocal-rank fusion (RRF).
- **Search**: Exa as the web-search provider behind a `SearchProvider` tool
  boundary.
- **Auth**: Better Auth email/password with email verification required.

### 4.1 Environment reality

The AI Gateway is only available on Convex Cloud deployments. The development
story is: run against a **Convex cloud dev deployment** with the gateway enabled.
There is no local/mock model path; local dev runs UI and DB only.

### 4.2 Config and secrets

All model/gateway calls run on the Convex backend. The following are Convex
deployment environment variables (never in frontend env files):

| Variable | Purpose | Default |
| --- | --- | --- |
| `GATEWAY_MODEL_ID` | Default agent model for all roles | required, no default |
| `GATEWAY_COMPARISON_MODEL_IDS` | Comma-separated model IDs allowed for replay comparison | empty |
| `GATEWAY_EMBEDDING_MODEL` | Embedding model | `text-embedding-3-small` |
| `GATEWAY_EMBEDDING_DIMS` | Embedding dimensions | `1536` |
| `ADMIN_EMAIL` | Account allowed to view cross-user spend | required for admin |
| `EXA_API_KEY` | Exa web search | required for research |
| `SITE_URL` | Better Auth base URL (already required) | required |
| `BUDGET_MONTHLY_USD_DEFAULT` | Default monthly user budget | required |
| `BUDGET_ALERT_THRESHOLDS` | Alert firing thresholds | `0.8,1.0` |
| `RATE_LIMIT_RESEARCH_PER_HOUR` | Research runs/hour/user | `10` |
| `RATE_LIMIT_CHAT_PER_MINUTE` | Chat messages/minute/user | `30` |
| `MAX_DOCS_PER_THREAD` | Documents per research thread | `10` |
| `MAX_PDF_BYTES` | Max PDF size | `26214400` (25 MiB) |
| `MAX_PDF_PAGES` | Max pages per PDF | `100` |
| `MAX_REPORT_TOKENS` | Max output tokens for the writer report | `8000` |
| `RESEARCH_MAX_TASKS` | Max planner sub-tasks per run | `3` |

## 5. Core Domain Model

### 5.1 Thread model (shared thread + artifact tables)

- Each research session is **one user-facing Agent thread**. All agents
  (planner, researcher, writer, fact-checker) operate within that thread so
  messages, tool results, citations, and usage stay connected.
- To keep the user-facing thread readable, only the **writer's final report**
  is streamed to the thread as an assistant message. Planner, researcher, and
  fact-checker outputs are stored in **artifact tables** and rendered as
  structured workflow status, not as raw chat messages.
- Agent threads are managed by the Agent component's thread/message tables; the
  application adds its own `researchSessions` row keyed to the thread for mode,
  title, ownership, and status.

### 5.2 Thread modes

Each thread has a mode, fixed at creation:

- `chat`: uses the single stage-1 assistant agent. No workflow, no tools beyond
  what stage 2+ adds incrementally, no multi-agent run.
- `research`: launches the durable multi-agent workflow on each research
  question.

Users cannot switch a thread's mode after creation.

### 5.3 Application tables (schema.ts)

The following tables are added to the currently empty schema. Exact field names
are indicative; the required relationships and indexes are normative.

- `researchSessions`
  - `userId` (owner), `threadId` (Agent thread), `mode` (`chat` | `research`),
    `title`, `titleEdited` (bool), `status`
    (`idle` | `running` | `failed` | `completed` | `cancelled`), `createdAt`,
    `updatedAt`.
  - Indexes: by `userId`, by `threadId` (unique), by `userId + updatedAt`.
- `documents`
  - `sessionId`, `userId`, `storageId`, `filename`, `mimeType`, `sizeBytes`,
    `pageCount`, `status` (`uploading` | `extracting` | `embedding` | `ready` |
    `failed`), `error`, `createdAt`.
  - Indexes: by `sessionId`, by `userId`.
- `documentChunks`
  - `documentId`, `sessionId`, `userId`, `chunkIndex`, `text`, `tokenCount`,
    `pageStart`, `pageEnd`, `embedding` (array of `GATEWAY_EMBEDDING_DIMS`),
    `createdAt`.
  - Indexes: by `documentId`, by `sessionId`; vector index
    `by_embedding` (dimensions from config) filtered by `sessionId`; full-text
    search index `by_text` on `text` filtered by `sessionId`.
- `researchRuns`
  - `sessionId`, `userId`, `threadId`, `workflowId`, `question`,
    `status` (`pending` | `planning` | `researching` | `writing` |
    `verifying` | `completed` | `failed` | `cancelled`),
    `modelId`, `createdAt`, `updatedAt`, `error`.
  - Indexes: by `sessionId`, by `userId + status`, by `workflowId`.
  - **Invariant**: at most one run per session with a non-terminal status.
- `researchArtifacts`
  - `runId`, `sessionId`, `kind` (`plan` | `finding` | `draft` | `critique`),
    `payload` (JSON), `createdAt`.
  - Indexes: by `runId`, by `runId + kind`.
- `sources`
  - `runId`, `sessionId`, `index` (the `[n]` number), `kind` (`web` | `document`),
    `title`, `url`, `documentId`, `chunkId`, `snippet`, `dedupeKey`, `createdAt`.
  - Indexes: by `runId + index` (unique), by `runId`, by `dedupeKey`.
- `toolUsage`
  - `userId`, `sessionId`, `runId`, `tool` (`exa.search`, `pdf.extract`, ...),
    `units`, `estimatedCostUsd`, `createdAt`.
  - Indexes: by `userId`, by `runId`.
  - Paid non-LLM tools are tracked here, separate from gateway LLM spend.
- `budgetAlerts`
  - `userId`, `period` (`YYYY-MM`), `threshold`, `firedAt`.
  - Indexes: by `userId + period` (unique per threshold).
- `budgetIncreases`
  - `userId`, `period`, `amountUsd`, `grantedBy` (admin userId/email),
    `createdAt`, `note`.
  - Indexes: by `userId + period`.
- `usageLedger`
  - `userId`, `sessionId`, `runId`, `feature`
    (`chat` | `plan` | `research` | `write` | `fact_check` | `embedding`),
    `modelId`, `inputTokens`, `outputTokens`, `costUsd`, `createdAt`.
  - Indexes: by `userId + createdAt`, by `runId`, by `feature`.
  - **Retention**: usage rows are kept even when content is deleted (see 9.3).

## 6. Stage-by-Stage Specification

Each stage must work end-to-end before the next begins. Acceptance criteria for
the project require all seven stages to be demoable.

### Stage 1 — Persistent chat

- One assistant agent, created via the Agent component, model
  `GATEWAY_MODEL_ID`.
- Create and resume threads; persist user and assistant messages.
- Stream assistant responses token-by-token to the UI using Convex reactivity
  (no SSE/WebSocket layer of our own).
- Thread mode `chat` supports this; mode `research` may initially behave the
  same until stage 4.

**Done**: a user can create a chat thread, send a message, see a streamed reply,
refresh the page, and still see the full history.

### Stage 2 — Research tool

- Add an Exa-backed `SearchProvider` tool behind a stable tool interface.
- Persist tool calls and results with the thread; render sources as `sources`
  rows and inline `[n]` citations.
- Record each Exa call in `toolUsage` with an estimated cost.
- Enforce a per-run search-call cap equal to `RESEARCH_MAX_TASKS` (see 7.2).

**Done**: a chat-mode question that triggers search shows a cited answer with
clickable source cards and a `toolUsage` record.

### Stage 3 — Documents and RAG

- Upload PDFs to Convex file storage; parse with `unpdf`/pdf.js inside a Convex
  action. No OCR and no hosted parser in v1; scanned PDFs without a text layer
  fail with a clear "no extractable text" error.
- Enforce `MAX_DOCS_PER_THREAD`, `MAX_PDF_BYTES`, `MAX_PDF_PAGES` at upload and
  ingestion.
- Chunk text into fixed-size token windows with overlap; store `pageStart`/
  `pageEnd` for provenance.
- Embed chunks through the gateway with `GATEWAY_EMBEDDING_MODEL` /
  `GATEWAY_EMBEDDING_DIMS`; record embedding calls in `usageLedger` as feature
  `embedding`.
- Hybrid retrieval: query the vector index and the full-text index for the
  session, merge with reciprocal-rank fusion, and return the top merged chunks.
  Vector-only is not sufficient; keyword-only is not sufficient.

**Done**: a PDF can be uploaded, becomes `ready`, and a question whose answer is
only in the PDF retrieves the relevant chunk and cites it with page numbers.

### Stage 4 — Multi-agent collaboration

Roles (all using `GATEWAY_MODEL_ID`):

- **Planner**: decomposes the question into up to `RESEARCH_MAX_TASKS`
  sub-queries. Stored as a `plan` artifact.
- **Researcher**: runs one parallel step per planned task, each performing web
  search and/or document retrieval. Findings stored as `finding` artifacts and
  `sources` rows.
- **Writer**: combines findings into a cited report using inline `[n]` markers.
  Output is stored as a `draft` artifact and streamed to the thread as the final
  assistant message.
- **Fact-checker**: identifies unsupported or contradictory claims and annotates
  them with confidence notes. Stored as a `critique` artifact. **Annotate only —
  no re-research loop, no additional model calls beyond the single verification
  pass, and no automatic rewriting of claims.**

Researcher fan-out is parallel with a maximum of 3 tasks per run.

**Done**: a research run produces a streamed, cited report plus a fact-check
annotation, with each role's output visible as workflow status/artifacts.

### Stage 5 — Durable workflow

- Implement the pipeline as `@convex-dev/workflow` steps: plan, research
  (parallel children), write, verify.
- Preserve progress across page refreshes and transient failures; the workflow
  continues server-side if the browser disconnects.
- On reopen, the UI reflects current status and any completed artifacts/report.
- Expose workflow status (`researchRuns.status`) in the UI, including a
  step timeline.
- **Concurrency**: at most one active workflow per thread. A second submit is
  rejected with a clear message. Enforce via the `researchRuns` invariant.

**Done**: killing the browser tab during a run does not stop the run; reopening
shows it completing and the final report appears.

### Stage 6 — Usage and cost controls

- Route all generation and embedding calls through the Convex AI Gateway and
  `ai-budget`.
- Attribute every call to a `userId` and `feature` via `usageLedger` and
  `ai-budget`.
- Enforce a **per-user global** monthly budget. No per-feature or per-thread
  sub-caps in v1.
- Budget window: monthly calendar in UTC, resetting on the 1st.
- **Reservation strategy**: reserve the model's worst-case `max_tokens` before
  the call; settle actual cost after the response. Never start a call whose
  reservation would exceed the remaining budget.
- **Over-budget behavior**: hard fail before the model call. The run moves to
  `failed` with an explicit budget error; any already-open reservations are
  settled for what actually ran.
- Threshold alerts at `BUDGET_ALERT_THRESHOLDS` (default 80% and 100%), firing
  at most once per threshold per monthly period.
- Frequency limits in addition to spending caps: `RATE_LIMIT_RESEARCH_PER_HOUR`
  research runs/hour/user and `RATE_LIMIT_CHAT_PER_MINUTE` chat messages/minute
  per user.
- Track paid non-LLM tool calls (Exa) separately in `toolUsage`.

**Done**: a user with an exhausted budget cannot start a model call; concurrent
requests near the cap never both succeed past it; alerts fire once per threshold.

### Stage 7 — Budget testing and operations

- Verify over-budget requests fail before reaching a model.
- Test concurrent requests near a user's spending limit.
- Replay a selected recorded request with a model from
  `GATEWAY_COMPARISON_MODEL_IDS` and compare output, latency, and cost. Cross-model
  replay is allowed even though the default agent model is single.
- Budget increases: **admin-only manual raise** via the dashboard. Alert firing
  is recorded; there is no user-facing increase-request flow in v1.
- Document the operational runbook for alerts and one-time increases.

**Done**: replaying a recorded run with a comparison model works and records the
comparison; an admin can raise a user's budget for the current period.

## 7. Cost-Control Design

### 7.1 Loop

1. Estimate cost for the intended call using worst-case `max_tokens`.
2. `ai-budget` reserves that estimate against the user's monthly budget.
3. If reservation would exceed the remaining budget, fail before the call.
4. Gateway executes the call; response returns actual usage and cost.
5. Settle the reservation with actual cost; write `usageLedger`.
6. Evaluate alert thresholds for the period.

This avoids the check-then-spend race of naive implementations.

### 7.2 Per-run ceilings

- Planner: exactly 1 model call.
- Researcher: at most `RESEARCH_MAX_TASKS` parallel tasks, each with at most one
  search call and one generation call.
- Writer: 1 model call, output bounded by `MAX_REPORT_TOKENS`.
- Fact-checker: 1 model call.
- Embeddings: counted separately and enforced under the same user budget.

### 7.3 Failure semantics

- Transient step failure (model error, Exa timeout, embedding failure): retry
  with backoff using Workflow component retries. After max attempts, mark the
  step failed and fail the run.
- No graceful partial report and no model downgrade on budget exhaustion. Hard
  fail is the defined behavior.
- Settle reservations for any work that did run before failing.

## 8. Retrieval Design

- **Chunking**: fixed-size token windows with overlap (target ~500–800 tokens,
  ~15% overlap), preserving page ranges.
- **Embedding**: `text-embedding-3-small`, 1536 dimensions, via gateway.
- **Indexes**: a Convex vector index over `documentChunks.embedding` filtered by
  `sessionId`; a full-text search index over `documentChunks.text` filtered by
  `sessionId`.
- **Merge**: reciprocal-rank fusion across the two ranked lists; return top-N
  merged chunks to the researcher.
- **Citations**: retrieved chunks produce `sources` rows of kind `document` with
  document title, page range, and snippet.

## 9. UI / UX

### 9.1 Layout

- Authenticated app shell with a **session sidebar**: auto-title from the first
  user message, inline rename, and delete. List sorted by `updatedAt`.
- Chat view: message list with streaming assistant output; composer disabled
  while a research run is active.
- Research view: the final report streams into the thread; above it, a
  collapsible **step timeline** showing planner tasks, researcher activity,
  writer status, and fact-check annotations.

### 9.2 Citations

- Report text uses inline `[n]` markers.
- A source-cards section renders below the report: title, URL or document/page,
  snippet. Deduplicate by canonical URL or chunk ID (`dedupeKey`).

### 9.3 Lifecycle and retention

- Upload progress and per-document status (`extracting`/`embedding`/`ready`/
  `failed`) are shown in the session.
- Deleting a thread: cancel any active workflow, settle open reservations, then
  cascade-delete messages, documents, chunks/embeddings, artifacts, and sources.
  Keep `usageLedger`, `toolUsage`, `budgetAlerts`, and `budgetIncreases`
  (anonymized to `userId`) for cost history.
- Account deletion follows the same cascade for all owned sessions while
  retaining usage ledger rows.

### 9.4 Error states

- Budget exhausted: explicit message stating the budget cap was reached, with
  the period and cap; run marked `failed`.
- Rate limited: explicit retry-after message.
- Ingestion failure: per-document error with retry.
- Workflow failure: step marked failed, retry button on the run.

## 10. Auth and Admin

- Better Auth email/password. **Email verification is required** before a user
  can start any run (chat or research) to protect budget from throwaway
  accounts.
- `ADMIN_EMAIL` identifies the admin account. The admin route checks this on the
  backend; the frontend route is a thin wrapper.
- Admin UI mounts the `ai-budget` component's **built-in dashboard** at an
  admin-only route. Minimal custom UI. Budget increases are applied from here.

## 11. Testing Strategy

- Abstract the gateway/model client behind an injectable interface so tests can
  supply a **fake model** with deterministic token counts and costs.
- Assert reservation/settlement behavior and ledger writes with no real spend:
  - reservation created before call; settled after
  - over-budget call is rejected before execution
  - concurrent requests near the cap cannot both exceed it
  - alerts fire once per threshold per period
- Unit-test heuristic pieces that don't need a model: chunking, RRF merge,
  citation dedupe, planner task cap.
- Workflow transition tests with the fake model for success and failure paths.
- No test suite exists yet; this section defines the suite to add. Do not assume
  an existing test command.

## 12. Acceptance Criteria

The project is complete when all seven stages are demoable against a real Convex
Cloud deployment with the gateway enabled:

1. Create/resume a chat thread and receive a streamed, persisted reply.
2. A research question uses Exa and shows cited sources with a `toolUsage` row.
3. A PDF uploads, becomes `ready`, and is retrieved/cited by page.
4. A research run produces a streamed report, artifacts per role, and a
   fact-check annotation.
5. A run survives a browser refresh/disconnect and completes server-side.
6. Over-budget calls fail before reaching a model; alerts and rate limits work.
7. A recorded request replays with a comparison model; an admin can raise a
   user's budget for the period.

Verification: `pnpm run lint && pnpm run check-types`, plus the Convex backend
typecheck command documented in `AGENTS.md`.

## 13. Risks and Trade-offs

- **Gateway availability**: requires a paid Convex plan and Convex Cloud; no
  local model path means contributors need deployment access.
- **Beta components**: the AI Gateway and `ai-budget` may change; interfaces
  should be wrapped where practical.
- **Worst-case reservation**: reserving `max_tokens` can transiently block
  budget that would not actually be spent, tightening effective budget.
- **Parallel researcher fan-out**: up to 3 concurrent calls plus writer/checker
  increases peak spend and makes mid-run hard-fail more likely near the cap.
- **No OCR**: scanned PDFs are unsupported in v1.
- **Annotate-only fact-check**: reports may ship with flagged claims rather than
  corrected ones.
- **Admin via env email**: single-admin model; acceptable for v1, not for teams.

## 14. Decision Log

| Topic | Decision |
| --- | --- |
| Dev model path | Cloud dev deployment + real gateway only |
| First slice | Persistent chat + streaming |
| Orchestration | Convex Workflow component drives role agents |
| Web search | Exa |
| Budget scope | Per-user global |
| Over budget | Hard fail before the call |
| Role outputs | Shared thread + artifact tables; stream final report only |
| Models | Single env-configured `GATEWAY_MODEL_ID` for all roles |
| PDF parsing | In-Convex `unpdf`/pdf.js, no OCR |
| Retrieval | Hybrid vector + full-text with RRF, 3-small/1536 |
| Reservation | Worst-case `max_tokens`, settle actual |
| Admin access | Hardcoded `ADMIN_EMAIL` env + built-in dashboard |
| Resume | Continue server-side, reflect on reopen |
| Concurrency | One active workflow per thread |
| Rate limits | 10 research/hr, 30 chat/min per user |
| Retention | Cascade content, keep usage ledger |
| Testing | Injectable fake model + ledger assertions |
| Budget window | Monthly calendar, UTC |
| Replay | Allowed with `GATEWAY_COMPARISON_MODEL_IDS` |
| Run caps | 10 docs/thread, 25 MiB/PDF, 100 pages, 8k report tokens |
| Session list | Auto-title, editable, sidebar with rename/delete |
| Email | Verification required |
| Fan-out | Parallel researcher, max 3 tasks |
| Alerts | Configurable, default 80%/100% |
| Delete mid-run | Cancel, settle, then cascade delete |
| Definition of done | All 7 stages demoable |
