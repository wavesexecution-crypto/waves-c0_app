# Deployment — Acquisition OS

## Target

- Vercel `team_4yzMS5Im7cXbCms5w6U4iWsR` / `prj_4MAbxJuodhhBJUpEhCH8MQuCpMBQ` → `https://app.wavesco.in` (prod alias), `https://waves-c0-app.vercel.app`, `https://waves-c0-app-git-main-*.vercel.app`.
- Project `.vercel/project.json` + build `vercel.json: buildCommand pnpm --filter @wavesco/db db:generate && next build && node scripts/copy-prisma-engine.mjs` outputs `.next/**` (`turbo.json:build`).
- Last prod Ready before Control Center: `dpl_2CZhrZ5KFaR3jMafyA1zxf9dWFof` `Sun Aug 30 2026 05:08:12 GMT+0530` (3d ago), commit `29ba04d` (freeze). Control Center lands HEAD `5255c56` + Task 14 docs/e2e.

## Pre-flight (must pass before deploy)

```bash
git status                   # no .env diff
git diff --stat HEAD         # review
pnpm --filter web test       # 103 passed (17 suites) incl. tests/e2e
pnpm --filter web test:e2e   # 3 passed discover→audit or BLOCKED
pnpm build                   # turbo db:generate + next build --turbopack + copy-prisma-engine
```

Optional: `vercel env pull` to sync `.env` locally.

## Deploy (either path)

```bash
# path A — via Vercel CLI
vercel --prod --yes

# path B — via git (Vercel builds on push)
git add -A && git commit -m "docs: complete Acquisition OS Control Center + Master Dossier + e2e" && git push origin main
```

Check `vercel ls waves-c0-app` shows new `dpl_* Ready` and alias `app.wavesco.in`.

## Verify (after auth — unauth redirects `/login`)

- `https://app.wavesco.in/acquisition`
- `.../acquisition/leads` (control bar + export)
- `.../acquisition/campaigns` (launch/pause/resume/stop + ConfirmDialog)
- `.../acquisition/workflows` (BLOCKED if `N8N_BASE_URL` still missing, else live)
- `.../acquisition/agents` (ClientAiConfig enable/disable + usage)
- `.../acquisition/integrations` (health matrix, Test Connection masked)
- `.../acquisition/reports` (Documents — download, generate, lineage)
- `.../acquisition/email` + `.../acquisition/outreach` (templates, delivery)
- `.../acquisition/analytics` (funnel, workflow, token/cost)
- `.../system` (health/logs/errors/jobs/queues/db/config/audit logs)

All must return 200 with correct tenant-scoped state; BLOCKED integrations show `BLOCKED` pills not 500.

## Env (production)

`vercel env ls` (2026-09-02): `DATABASE_URL, DIRECT_URL, NEXTAUTH_URL, AUTH_SECRET, NEXTAUTH_SECRET, JWT_SECRET, LEAD_ENGINE_MODE=remote, LEAD_ENGINE_API_URL Hidden, LEAD_ENGINE_API_TOKEN Hidden, LEAD_ENGINE_GATEWAY_TOKEN Hidden, WAVESCO_ENGINE_TENANT Hidden, OPENAI_* Hidden` are SET; missing → BLOCKED: `N8N_BASE_URL, N8N_API_KEY, BREVO_API_KEY, OBSIDIAN_*`.

Add secret:
```bash
vercel env add N8N_BASE_URL production
vercel env add N8N_API_KEY production
vercel env add BREVO_API_KEY production
vercel --prod --yes   # redeploy to pick up
```

## Rollback

`vercel ls` retains `dpl_*` history; promote via dashboard `··· → Promote to Production` if error, or `git revert HEAD && git push`.

