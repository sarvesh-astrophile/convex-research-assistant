# Convex Research Assistant

A multi-agent research assistant built to learn the major capabilities of the
[Convex Agent component](https://www.convex.dev/components/agent) in one practical
project.

The finished application will work like a small, self-hosted Perplexity: users
can start research sessions, upload documents, ask questions, and receive a
streamed report produced by cooperating AI agents.

> [!NOTE]
> This repository is currently an application scaffold. The features below are
> the implementation roadmap, not a claim that they are all complete.

## Learning Goal

This project intentionally combines the features that are useful in future AI
applications instead of demonstrating each one in isolation:

| Convex/AI capability | How it will be used |
| --- | --- |
| Threads and messages | Persist each research session and its conversation history |
| Streaming | Display the answer while the model generates it |
| Tool calls | Let the researcher search the web and read uploaded documents |
| RAG and vector search | Retrieve relevant passages from uploaded PDFs |
| File storage | Store source documents used during research |
| Multiple agents | Coordinate planner, researcher, writer, and fact-checker roles |
| Durable workflows | Run plan, research, write, and verify steps reliably |
| Usage tracking | Record token use by user, thread, model, and feature |
| Cost accounting | Convert model and tool usage into estimated dollar costs |
| Rate and budget limits | Protect provider API keys from unbounded usage |

## Planned Workflow

```text
User question
    |
    v
Planner -> Researcher -> Writer -> Fact-checker
                |          |
                |          +-> streamed final report
                |
                +-> web search + document retrieval
```

All agents will work within the same research thread so their messages, tool
results, citations, and usage remain connected.

## Cost-Control Strategy

This project will use **our own model-provider API keys**. It will not require
the Convex AI Gateway.

The planned cost-control loop has four parts:

| Responsibility | Planned solution |
| --- | --- |
| Measure token usage | Convex Agent usage tracking |
| Estimate dollar cost | Neutral Cost pricing data |
| Limit request frequency | Convex Rate Limiter |
| Enforce spending caps | Application-level budget checks before expensive workflows |

Neutral Cost is a bookkeeper, not a gatekeeper. It can calculate and aggregate
estimated costs after usage is reported, but the application must separately
decide whether a request is allowed to run.

### Why not `ai-budget`?

The Convex `ai-budget` component is designed around the managed Convex AI
Gateway. The gateway provides centralized admission control and authoritative
request costs, but it requires an eligible paid Convex plan and does not match
this project's goal of learning with independently managed provider keys.

Using provider SDKs directly from Convex actions is an officially supported
alternative: store API keys in Convex environment variables and call the chosen
provider from an action.

### Trade-offs of this approach

Using our own keys and estimated pricing provides more control, but it does not
provide every guarantee of a gateway-backed budget system:

- Pricing estimates can drift when providers change their prices.
- A simple check-then-spend budget check can overshoot under concurrent requests.
- Request replay, threshold alerts, one-time budget increases, and an admin
  dashboard must be built separately.
- User, thread, and message attribution must be passed consistently when costs
  are recorded.

It also enables tracking non-LLM expenses, such as paid web-search tool calls,
and keeps model/provider selection under application control.

> [!IMPORTANT]
> Never place provider secrets in frontend environment variables or commit them
> to Git. Configure them for the Convex deployment and access them only from
> backend actions.

## Implementation Roadmap

### 1. Persistent chat

- Add one assistant agent.
- Create and resume threads.
- Persist user and assistant messages.
- Stream responses to the web interface.

This establishes the Agent, Thread, and Message mental model used by every later
stage.

### 2. Research tool

- Add a web-search tool.
- Persist tool calls and results with the thread.
- Display sources with generated answers.

### 3. Documents and RAG

- Upload and store PDF files.
- Extract and chunk document text.
- Generate embeddings with a provider API key.
- Retrieve relevant chunks using hybrid vector and text search.

Embedding calls are separate model requests and must be included in usage and
cost accounting.

### 4. Multi-agent collaboration

- Planner: decomposes a question into research tasks.
- Researcher: searches the web and uploaded documents.
- Writer: combines findings into a cited report.
- Fact-checker: identifies unsupported or contradictory claims.

### 5. Durable workflow

- Run plan, research, write, and fact-check as recoverable steps.
- Preserve progress across page refreshes and transient failures.
- Expose workflow status in the UI.

### 6. Usage and cost controls

- Record token usage for each generation and embedding call.
- Convert usage to estimated costs with maintained model pricing.
- Track paid tool calls separately.
- Add per-user request limits.
- Check daily or monthly spend before starting expensive work.
- Build a small usage view by user, thread, model, and feature.

### 7. Optional managed-budget comparison

If the application later moves to an eligible paid Convex plan, evaluate the AI
Gateway and `ai-budget`. Compare their reserve-and-settle enforcement with the
application-level budget checks implemented in stage 6.

## Current Stack

- TypeScript
- React and TanStack Start
- Convex
- Better Auth
- Tailwind CSS
- shadcn/ui shared components
- pnpm workspaces
- Vite+
- Oxlint and Oxfmt

## Repository Structure

```text
convex-research-assistant/
|-- apps/
|   `-- web/             # TanStack Start frontend
|-- packages/
|   |-- backend/         # Convex schema, functions, and configuration
|   |-- config/          # Shared TypeScript configuration
|   |-- infra/           # Deployment infrastructure
|   `-- ui/              # Shared UI components and styles
`-- README.md
```

## Getting Started

### Prerequisites

- Node.js or Bun supported by the project toolchain
- pnpm `12.5.1`
- A Convex account
- A model-provider API key when AI features are added

### Install dependencies

```bash
pnpm install
```

### Configure Convex

```bash
pnpm run dev:setup
```

Follow the prompts to create or select a Convex project. Copy the public Convex
environment values generated in `packages/backend/.env.local` to the web app's
local environment file when prompted by the setup flow.

Provider API keys should be configured as Convex deployment environment
variables, for example:

```bash
pnpm --filter @convex-research-assistant/backend exec convex env set PROVIDER_API_KEY your-key
```

`PROVIDER_API_KEY` is a placeholder. Use the environment variable expected by
the provider SDK selected during implementation.

### Start development

```bash
pnpm run dev
```

Open [http://localhost:3001](http://localhost:3001).

## Available Scripts

| Command | Purpose |
| --- | --- |
| `pnpm run dev` | Start workspace development tasks |
| `pnpm run dev:web` | Start only the web application |
| `pnpm run dev:server` | Start only Convex development |
| `pnpm run dev:setup` | Configure the Convex project |
| `pnpm run build` | Build all applications |
| `pnpm run check-types` | Type-check workspace applications |
| `pnpm run check` | Run formatting, linting, and workspace checks |
| `pnpm run lint` | Run Vite+ lint checks |
| `pnpm run format` | Format the workspace |
| `pnpm run hooks:setup` | Configure Vite+ Git hooks |

## Design Principles

- Build one working vertical slice before adding more agents.
- Attribute every model and paid-tool call to a user and thread.
- Check limits before expensive work and record actual usage afterward.
- Treat locally calculated dollar costs as estimates, not provider invoices.
- Keep secrets and provider calls on the Convex backend.
- Add complexity only when the current stage works end to end.

## References

- [Convex Agent component](https://www.convex.dev/components/agent)
- [Convex AI Gateway](https://docs.convex.dev/ai-gateway)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)
