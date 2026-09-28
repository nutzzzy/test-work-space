# QA Engineering Workbench

Local-first AI-powered QA Engineering Workbench (Phases 1–5).

## Stack

- **Web:** Next.js, Tailwind CSS, shadcn/ui, Apache ECharts
- **API:** NestJS, Prisma
- **Infra:** PostgreSQL, Redis (Docker Compose)
- **AI:** AIProvider + Ollama (heuristic fallback offline)
- **Shared:** `@qa-workbench/shared` types & Zod schemas

## Quick start

```bash
cp .env.example .env && cp .env apps/api/.env
npm install
npm run docker:up
npm run db:generate
npm run db:migrate
npm run dev:api   # http://localhost:3001/api/health
npm run dev:web   # http://localhost:3000
```

Offline demo (no Jira/Ollama required):

1. Open **Jira** → **Load demo issue**
2. Open workspace → **Generate all AI artifacts**
3. Execute test cases / create suites / build scenarios

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev:web` / `dev:api` | Dev servers |
| `npm run build` | Build all |
| `npm run test` | Unit tests |
| `npm run lint` | Lint |
| `npm run typecheck` | TypeScript |
| `npm run docker:up` | Postgres + Redis |

## Phase status

- **Phase 1:** Monorepo foundation + dark UI shell
- **Phase 2:** JiraAdapter, AIProvider/Ollama, analysis & generation
- **Phase 3:** Workspace, suites, runs, bugs, dashboard
- **Phase 4:** Environments, Scenario Builder, HTTP/assert/extract
- **Phase 5:** SET/DELAY/CONDITION, live run, cancel, failure behavior, history
