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
| Cost accounting | Attribute model usage and cost to users and features |
| Rate and budget limits | Prevent unbounded AI spending |

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

This project will use the **Convex AI Gateway** with the `ai-budget` component.
Convex manages provider credentials, while the application authenticates to the
gateway with a short-lived token scoped to its deployment.

The planned cost-control loop has four parts:

| Responsibility | Planned solution |
| --- | --- |
| Measure token usage | Convex Agent and AI Gateway usage data |
| Calculate model cost | Authoritative gateway pricing through `ai-budget` |
| Limit request frequency | `ai-budget` request limits and Convex Rate Limiter where needed |
| Enforce spending caps | `ai-budget` reserve-and-settle budget enforcement |

Before an LLM request runs, `ai-budget` reserves its estimated cost against the
relevant budget. After the response, it settles the reservation using the
gateway's actual cost. This avoids the concurrency race in a basic
check-then-spend implementation.

The component will also provide:

- Per-user dollar, token, and request limits.
- Cost attribution by user and feature.
- Budget threshold alerts and one-time increases.
- Request history, latency data, and replay for model comparisons.
- An admin dashboard for inspecting usage and spend.

Paid non-LLM tools, such as web search, are not gateway model calls. Their costs
must be tracked and limited separately if the selected tool charges per request.

### Requirements and trade-offs

- The AI Gateway requires an eligible paid Convex plan.
- It is available on Convex Cloud deployments, not local or self-hosted backends.
- Model selection is limited to models supported by the gateway.
- The AI Gateway and `ai-budget` are evolving services and may change while in
  beta.

> [!IMPORTANT]
> Do not add provider API keys to the frontend or repository. This project uses
> gateway-managed credentials rather than application-managed provider keys.

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
- Generate embeddings through the Convex AI Gateway.
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

- Route generation and embedding calls through the Convex AI Gateway.
- Connect each Agent model through `ai-budget`.
- Configure per-user dollar, token, and request limits.
- Set daily or monthly budgets and threshold alerts.
- Track paid non-LLM tool calls separately.
- Mount and use the admin dashboard to inspect spend and request history.

### 7. Budget testing and operations

- Verify that over-budget requests fail before reaching a model.
- Test concurrent requests near a user's spending limit.
- Replay selected requests with another supported model and compare results.
- Add an operational process for alerts and one-time budget increases.

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
- A Convex team on an eligible paid plan
- Access to the Convex AI Gateway

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

Provider API keys are not configured in this application. Follow the
[AI Gateway setup guide](https://docs.convex.dev/ai-gateway/setup) to enable the
gateway for the Convex team and deployment.

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
- Attribute every model call to a user and feature through `ai-budget`.
- Configure budgets before enabling expensive research workflows.
- Treat paid non-LLM tool usage as a separate cost-control concern.
- Keep all model and gateway calls on the Convex backend.
- Add complexity only when the current stage works end to end.

## References

- [Convex Agent component](https://www.convex.dev/components/agent)
- [Convex AI Gateway](https://docs.convex.dev/ai-gateway)
- [Convex actions](https://docs.convex.dev/functions/actions)
- [Convex environment variables](https://docs.convex.dev/production/environment-variables)
- [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack)
