# TASK: Railway Live UAT For Timeline Booking Details

- Status: pending after `v0.77.109` deploy
- Type: release verification task
- Production impact: yes
- Parent: `docs/TASK-timeline-booking-details-canonical-interface-2026-07-03.md`

## Goal

After the canonical details fix is implemented and pushed, verify on Railway
that the live production site serves the correct version and the booking detail
click flow uses the canonical Ukrainian interface.

## Railway Context

Current linked Railway context:

- Workspace: `Сергей Шарлай's Projects`
- Project: `fortunate-appreciation`
- Service: `8223324090`
- Production URL: `https://8223324090-production.up.railway.app`
- Production branch: `codex/timeline-leads-hardening`

Do not change Railway settings, variables, secrets, service ownership, or
environment configuration without explicit user approval.

## Required Checks

Run after the fix deploy completes:

```bash
npx -y -p node@22 -p npm@10 -c "npm run version:smoke -- https://8223324090-production.up.railway.app"
npx -y -p node@22 -p npm@10 -c "npm run release:timeline-proof -- https://8223324090-production.up.railway.app"
railway logs --lines 100
railway logs --http --status ">=400" --lines 100
```

## Manual UAT

Use an authenticated browser session:

1. Open production timeline.
2. Set date to `2026-07-03`.
3. Open the timeline mode that shows the `AH(60)` and
   `+Вед(60): Додатковий ведучий` blocks.
4. Click `AH(60)`.
5. Click `+Вед(60): Додатковий ведучий`.
6. Confirm both open the canonical modal.

Canonical modal must include:

- full Ukrainian title and labels;
- event card image;
- `Дата`;
- `Час активності`;
- `Аніматори`;
- `Сценарій`;
- `Статус`;
- `Оновлено`;
- footer actions: edit, banquet sheet, more.

The modal must not include:

- `Recovery після detail API`;
- `TL-BK-DETAIL-RECOVERY-OPENED`;
- a simplified field-only details table.

## Acceptance Criteria

- Live `/api/version` matches `package.json`.
- Live timeline assets use the new `?v=` cache tag.
- Both affected booking blocks open canonical details.
- Railway logs show no new server-side errors for the tested clicks.
- Any remaining frontend exception is captured with a concrete diagnostic code
  and does not switch to a parallel recovery UI.
