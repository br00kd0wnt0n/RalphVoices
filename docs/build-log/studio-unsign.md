# Studio: removing a territory's sign-offs (a script, run by hand)

Brook, 5 Oct 2026. Three sign-offs were made on Sock Eater while trying Build; they were never a decision. `backend/scripts/studio-unsign.ts` (logic and the list of what a sign-off writes: `backend/src/services/studio/unsign.ts`) removes a territory's sign-offs for a region, so the asset is "not signed off" again and its codes start at A1. It is not part of the app.

```bash
# Dry run (the default): prints every row it would delete or change, writes nothing
npx tsx scripts/studio-unsign.ts --territory DINK_SOCK_EATER_DOG --region US --database-url postgresql://…
# Apply, after a backup: the ids are the ones the dry run printed
npx tsx scripts/studio-unsign.ts --territory DINK_SOCK_EATER_DOG --region US --database-url postgresql://… \
  --apply --signoffs ID1,ID2,ID3 --by brook@ralph.world --allow-remote
```

- Never reads `backend/.env` or `DATABASE_URL`. A non-local database needs `--allow-remote` to write.
- One transaction. It stops, writing nothing, if: the sign-offs in the database are not exactly the ids named; a code has an upload, upload stub, audit, audit flag, asset status, asset history or compliance record; a code is also in a sign-off that stays; a line changed while it ran; the kept lines per run would change.
- Deleted: the sign-offs, their expectations, and the line versions those sign-offs created.
- Lines: `ready` is removed (decision, wording, flags, who and when are untouched), and `decided_at` goes back to the line's last change before the sign-offs when nothing has happened to the line since.
- A shared caption that another territory's sign-off also holds keeps that sign-off's mark and its line version.
- Kept: the edit log's sign-off entries (they happened), with one new entry per line saying the sign-offs were removed, so the line's history reads "ready for production" then "not signed off". Spend from the version checks stays.
- Test: "removing a territory's sign-offs (unsign)" in `studioPg.test.ts`.
