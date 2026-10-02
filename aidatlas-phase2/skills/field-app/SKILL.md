# Skill: field-app (field reports)

Ground truth from field teams into the plan, even when networks fail.

## Code
- `src/field.html` → `field.html` (built, self-contained) + `js/field-page.js`: capture form, IndexedDB outbox, share/copy, sign-in.
- `js/field.js` (`AA.field`): report model, `normalise`, `encode`/`decodeAll` (AA1 code), `shareText`, `match`, `toEvents`, `inPlanArea`, `cloudSend`, `cloudList`.
- `js/ui/field-ui.js` (`AA.fieldui`): plan section `#fieldSec`, paste, apply, 60-s polling of the shared back end.
- `js/ui/map.js` `MAP.drawField` (squares coloured by damage; grey = applied); 3D points via `map3d` hook.
- `sw.js` + `field.webmanifest`: offline start and "add to home screen" (http(s) only).
- `supabase/schema.sql`: role `field`, table `field_reports` (RLS: team read; field/planner/admin insert; own update; planner/admin delete), private bucket `field-photos` (first folder = team id).

## Report
`{ id (made on the phone, so retries never duplicate), at, lat, lon, acc (m), damage ∈ {0, .25, .5, .75, 1}, needs[], people {affected, injured, trapped}, road ∈ {open, partly, blocked}, note ≤ 500, by, team, trained, place, plan, photo }`.
Photos: ≤ 1280 px JPEG q 0.72 (~150 KB), Blob in IndexedDB until sent.

## Transport
1. Shared back end: `cloudSend` uploads `field-photos/<team>/<id>.jpg`, upserts the row; queued reports retry on `online`.
2. No back end: "Share" (Web Share API with text + photo file where supported, else clipboard). Code = `AA1.<base64url JSON>.<4-char FNV checksum>`; photo not included. `decodeAll` reads every code in a pasted chat message and rejects damaged ones.

## Applying to a plan
`match`: nearest zone within clamp(1.2 × catchment, 3, 25) km. `toEvents`: `report` (zoneId, value = damage, σ 0.1 trained / 0.2 crowd, fieldId) + `closure` at the point when the road is blocked. Events go through `ENG.event` with a decision-log note "Field report by …"; `fieldId` in `st.events` marks it applied, so saved plans remember.

## Acceptance
tests/phase2.test.js (codec round trip incl. unicode, several codes, checksum, size < 300 chars, validation, matching, events, Bayes through the engine, cloud upload paths) · tests/schema.test.mjs (field role, RLS, bucket) · E2E: phone form → outbox survives reload → code → paste in plan → apply → severity, closure, decision log.
