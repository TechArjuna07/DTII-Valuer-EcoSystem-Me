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

# 5. Platform Superadmin (prints a one-time set-password link when MAIL_PROVIDER=log)
$env:SEED_SUPERADMIN_EMAIL = "you@yourcompany.com"; pnpm --filter @valuers/backend db:seed:superadmin

# 6. Run
pnpm dev:api     # API on :4100
pnpm dev:web     # Web on :3100 (proxies /api/v1 to the API)
```

After that, everything happens in the web app:
1. The Superadmin registers a firm (`/platform/firms/new`). The firm gets a permanent code (`FIRM001`…) and its Firm Admin gets an invitation.
2. The Firm Admin registers employees (Marketing, Field Officer, Junior or Senior Reviewer) and clients. Clients can optionally get a portal login.
3. Invited people set their own password from the emailed link. With `MAIL_PROVIDER=log`, the link is shown in the UI and in the API log, for development only.

## Security model (summary)

- **Authentication:** Argon2id passwords. 10-minute JWT access tokens are held in browser memory only. 7-day refresh tokens are HttpOnly, `SameSite=Strict` cookies that rotate on every use; replaying an old token revokes the whole session family. A CSRF double-submit header protects the cookie endpoints. An account locks after 5 failed sign-ins. Users can sign out individual devices.
- **Tenancy:** the firm always comes from the verified token, never from the request. Every query is scoped to that firm. Another firm's records return **404**, never 403, so their existence is not revealed.
- **Authorisation:** routes check permissions, not role names. Roles, sessions and permissions are re-checked on every request (cached for at most 30 seconds, and cleared immediately on deactivation, suspension or role changes). Firm Admins can toggle non-critical permissions; critical ones are fixed by the platform.
- **Data protection:** PAN is AES-256-GCM encrypted, matched for duplicates by HMAC, and only ever shown masked. Logs redact credentials, tokens and cookies. Every security-relevant action writes an append-only audit row.
- API documentation: Swagger UI at http://localhost:4100/api/docs, generated from the route registry, so it always matches the code.

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

## Running the background worker

`RUN_MODE=all` (the default in `backend/.env`) runs the BullMQ workers (email, malware scan, SLA sweep, signature
polling) inside the API process. In production run them separately:

```powershell
pnpm --filter @valuers/backend start:worker     # RUN_MODE=worker
```

## Documentation

| Document | Contents |
|---|---|
| [docs/PHASE_1_ARCHITECTURE_AND_PLAN.md](docs/PHASE_1_ARCHITECTURE_AND_PLAN.md) | Architecture, ER diagrams, RBAC matrix, workflow, decisions |
| [docs/API.md](docs/API.md) | API overview (full reference: Swagger at `/api/docs`) |
| [docs/DATABASE.md](docs/DATABASE.md) | Tables, roles, database-enforced integrity rules |
| [docs/VAPT_CHECKLIST.md](docs/VAPT_CHECKLIST.md) | Security controls mapped to automated tests, residual risks |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment (S3, PostgreSQL, Redis, nginx, PM2, email, go-live checklist) |

Load test (against a running API): `LOAD_EMAIL=… LOAD_PASSWORD=… node backend/scripts/load-test.js --create 50`.
Mobile camera / GPS testing over HTTPS: `pnpm --filter @valuers/frontend dev:https`.

## Development status

| Phase | Status |
|---|---|
| 1. Inspection & design | ✅ |
| 2. Project setup | ✅ |
| 3. Authentication & multi-tenancy | ✅ |
| 4. Case management (Case IDs, masters, workflow, assignments) | ✅ |
| 5. Document repository (versions, folder ACL, signed links, requests) | ✅ |
| 6. Inspection workflow (mobile, GPS with consent, photos) | ✅ |
| 7. Valuation workflow (engines, reviews, bank templates, PDF, verification QR) | ✅ |
| 8. Client approval & digital signatures | ✅ |
| 9. Bank submission, sanction & disbursement | ✅ |
| 10. Notifications, email queue, dashboards & reports | ✅ |
| 11. Security & production readiness | ✅ (see the residual risks in the VAPT checklist) |
