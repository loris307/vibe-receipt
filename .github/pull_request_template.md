## What & why

<!-- One or two sentences. Link issues if relevant. -->

## Checklist

- [ ] `pnpm lint` clean
- [ ] `pnpm typecheck` clean
- [ ] `pnpm test` green
- [ ] `pnpm build` succeeds
- [ ] If a bug fix: scanned `fixes.md` Resolved list for nearby issues to avoid regressing them
- [ ] If `Receipt` shape changed: updated `src/data/receipt-schema.ts` first, then propagated through aggregate → render → ansi
