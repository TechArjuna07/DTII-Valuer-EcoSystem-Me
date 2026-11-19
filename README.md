# DTII Valuers Ecosystem

A secure, multi-tenant platform that digitises the property valuation workflow between valuation firms, clients (loan applicants), banks and NBFCs. Each case gets a permanent Case ID and its own document repository, workflow and append-only activity trail.

Architecture, ER diagrams, the RBAC matrix, the workflow and the phase plan are in [docs/PHASE_1_ARCHITECTURE_AND_PLAN.md](docs/PHASE_1_ARCHITECTURE_AND_PLAN.md).

## Tech stack

| Layer | Stack |
|---|---|
| **Frontend** (`frontend/`) | React 19 (JavaScript/JSX) · Vite 6 · React Router 7 · TanStack Query 5 · Axios · React Hook Form + zod · Tailwind CSS 4 · Radix UI · Lucide icons |
| **Backend** (`backend/`) | Node.js 22 · Express 5 (JavaScript ES modules) · Prisma 6 · zod · pino · helmet · BullMQ |
| **Database** | PostgreSQL 18, running **locally** (not in Docker) |
| **Cache / queues** | Redis 7.4 in a dedicated Docker container, `valuers-redis` |
| **Documents** | Local filesystem in development; private AWS S3 with signed URLs in production |

## Ports

| Service | URL |
|---|---|
| Web app | http://localhost:3100 |
| API | http://localhost:4100/api/v1 · Swagger at http://localhost:4100/api/docs |
| PostgreSQL | localhost:5432 |
| Redis | 127.0.0.1:6391 |

## First-time setup (Windows PowerShell)

Prerequisites: Node.js 22, pnpm 9, PostgreSQL 16+ running as a local service, and Docker Desktop.

```powershell
pnpm install

# 1. Secrets. Copy the templates and fill in random values (never commit .env files).
Copy-Item backend\.env.example backend\.env
Copy-Item infra\redis\.env.example infra\redis\.env
#    The Redis password must match in infra\redis\.env and backend\.env (REDIS_URL).

# 2. Redis (dedicated Docker container)
docker compose -f infra\redis\docker-compose.yml --env-file infra\redis\.env up -d

# 3. PostgreSQL roles and databases (prompts once for the postgres superuser password)
powershell -ExecutionPolicy Bypass -File infra\postgres\setup.ps1

# 4. Schema and reference data
pnpm --filter @valuers/backend db:migrate     # prisma migrate deploy (owner role)
pnpm --filter @valuers/backend db:seed        # roles, permissions, financial years

# 5. Run
pnpm dev:api     # API on :4100
pnpm dev:web     # Web on :3100 (proxies /api/v1 to the API)
```

On Linux, run `bash infra/postgres/setup.sh` instead of step 3. Every other step is the same, with `/` paths.

## Redis container commands

| Action | Windows PowerShell | Linux |
|---|---|---|
| Start | `docker compose -f infra\redis\docker-compose.yml --env-file infra\redis\.env up -d` | `docker compose -f infra/redis/docker-compose.yml --env-file infra/redis/.env up -d` |
| Stop | `docker compose -f infra\redis\docker-compose.yml --env-file infra\redis\.env stop` | `docker compose -f infra/redis/docker-compose.yml --env-file infra/redis/.env stop` |
| Status | `docker ps --filter name=valuers-redis` | `docker ps --filter name=valuers-redis` |
| Health | `docker inspect --format "{{.State.Health.Status}}" valuers-redis` | `docker inspect --format '{{.State.Health.Status}}' valuers-redis` |
| Ping | `docker exec valuers-redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping'` | same |
| Logs | `docker logs --tail 50 valuers-redis` | same |

Data lives in the named volume `valuers_redis_data`. `docker compose down` keeps the volume. `down -v` **deletes** it.

## Database roles

- `valuers_owner` owns the schema and runs migrations (`DATABASE_MIGRATION_URL`).
- `valuers_app` is the runtime role (`DATABASE_URL`). It can only read and write data. It **cannot** update, delete or truncate the append-only audit tables. PostgreSQL triggers enforce the same rule as a second layer.

Migrations are created with `pnpm --filter @valuers/backend db:migrate:dev --create-only` and reviewed before they are applied. Hand-written SQL (triggers, grants, CHECK constraints, sequences) lives at the end of each migration file.

## Tests

```powershell
pnpm test                                                      # backend unit + integration tests
pnpm --filter @valuers/backend test -- --selectProjects unit   # unit tests only (no services needed)
```

Integration tests run against `valuers_ecosystem_test` (migrated automatically) and Redis DB 1. They never touch development data.

## Project layout

```
backend/    Express API (src/config, database, middleware, modules, services, jobs, utils) + prisma/
frontend/   React SPA (src/components, layouts, pages, services, routes, context, hooks, utils)
infra/      redis/ (docker compose), postgres/ (role & database bootstrap scripts)
docs/       Architecture, API, database, security and deployment documentation
```

## Development status

| Phase | Status |
|---|---|
| 1. Inspection & design | ✅ Done |
| 2. Project setup | ✅ Done: workspace, PostgreSQL roles and migration, Redis container, API skeleton, design system, tests |
| 3–11 | Planned (see the Phase 1 document, §7) |
