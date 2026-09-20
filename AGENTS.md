# Repository Guide

## Current State

- This is an application scaffold. Most AI-agent, RAG, streaming, workflow, and budget features in `README.md` are a roadmap, not implemented behavior.
- Use pnpm `12.5.1`; workspace packages live under `apps/*` and `packages/*`.

## Architecture

- `apps/web` is a TanStack Start app. Routes are file-based under `src/routes`; `src/router.tsx` connects TanStack Query to Convex, and `src/routes/__root.tsx` establishes SSR auth.
- `packages/backend/convex` owns the Convex schema, functions, HTTP routes, and Better Auth component. `auth.ts` requires the Convex deployment variable `SITE_URL`.
- `packages/ui` is source-consumed through package subpath exports; shared components and the Tailwind theme belong here, not in an app-local UI directory. `apps/web/components.json` points shadcn UI generation at this package.
- `packages/infra/alchemy.run.ts` deploys the web app as a Cloudflare Worker through Alchemy and passes the public Convex URLs as bindings.
- Keep model/provider calls on the Convex backend. Do not add provider keys to frontend env files; the planned model path is the Convex AI Gateway.

## Commands

- Install: `pnpm install`.
- First-time Convex setup: `pnpm run dev:setup`; copy the generated public Convex values from `packages/backend/.env.local` into the web app environment when prompted.
- Full development: `pnpm run dev` (recursive package orchestration; backend plus the Alchemy-hosted web app). Web only: `pnpm run dev:web`. Convex only: `pnpm run dev:server`. The web port is `3001`.
- Build: `pnpm run build`. Focused web build/typecheck: `pnpm --filter web check-types`.
- Verify lint and workspace types: `pnpm run lint && pnpm run check-types`.
- `pnpm run check-types` covers web, UI, and infra but not Convex backend TypeScript. Check it separately with `pnpm --filter @convex-research-assistant/backend exec tsc -p convex/tsconfig.json --noEmit`.
- There is currently no test script or test suite. Do not invent a test command.
- `pnpm run check` is mutating: it runs `oxlint && oxfmt --write`. Use `pnpm run lint` for a non-formatting check and inspect changes after `check` or `format`.
- Deploy/destroy the Cloudflare web infrastructure with `pnpm run deploy` / `pnpm run destroy`.

## Generated And Environment Files

- Do not edit `apps/web/src/routeTree.gen.ts`; TanStack Start generates it from `src/routes` during dev/build.
- Do not edit `packages/backend/convex/_generated/**`; `convex dev` regenerates these APIs after backend/schema changes.
- `apps/web/src/env.ts` is generated and ignored. Change `apps/web/.env.schema`, then run `pnpm run env:generate` (also runs on postinstall).
- Local `.env*`, Convex `.env.local`, Alchemy state, Wrangler output, `.tanstack`, `.vinxi`, and build output are ignored; never commit credentials or generated deployment state.
