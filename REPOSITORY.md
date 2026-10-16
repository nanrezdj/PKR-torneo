# Suggested monorepo

```text
poker-tournament-manager/
  apps/
    web/
      src/
        app/
        features/{auth,tournaments,players,rebuy,payments,clock,results,design-studio}/
        components/{ui,casino}/
        styles/
      public/{icons,sounds}/
      vite.config.ts
    api/
      src/
        index.ts
        routes/{auth,tournaments,rebuy,payments,clock,results}.ts
        middleware/{session,authorization,idempotency}.ts
        services/{tournament,ledger,rebuy,prizes,clock}.ts
        durable-objects/TournamentRoom.ts
        db/
      migrations/0001_initial.sql
      wrangler.jsonc
  packages/
    contracts/src/
    domain/src/{money,prizes,permissions,states}.ts
    ui/src/
  tests/{integration,e2e,finance}/
  docs/{architecture,api,operations}/
  package.json
  pnpm-workspace.yaml
```

## Engineering notes
- Keep SQL migrations immutable after deployment; add numbered migrations for changes.
- Do not share a single mutable timer among tournaments.
- Audit logs must avoid exposing email tokens or secrets.
- Rebuy approvals are server-only and must re-check the cap in the same atomic operation.
- Frontend may optimistically show pending requests, never unconfirmed money as collected.
