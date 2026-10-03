# Skill: collab (shared live plan: tasks and comments)

Many agencies work on one plan: who does what, where, by when.

## Code
- `js/collab.js` (`AA.collab`): `tasks`, `comments`, `addTask`, `updateTask`, `removeTask`, `addComment`, `canCreate`, `canUpdate`, `isOverdue`, `snapshot`/`restore`, `pushLocal`, `merge`, `start`/`stop`/`markSaved`, events `tasks|comments|remote|newer|error`.
- `js/ui/collab-ui.js` (`AA.collabui`): plan section `#collabSec`.
- `supabase/schema.sql`: tables `plan_tasks`, `plan_comments`, function `plan_team(p)`, RLS, Realtime publication.

## Model
Task `{ id, title ≤ 200, zoneId, assignee (e-mail or name), due YYYY-MM-DD, status open|doing|done, note, by, at, updatedAt }`. Comment `{ id, text ≤ 1000, zoneId, by, role, at }`.

## Permissions
Create/delete task: planner, admin. Change a task: planner, admin, or its assignee. Comment: every role. The database enforces the same (RLS), and blocks rows that point at another team's plan.

## Where data lives
- `plan` mode (no back end or plan not saved): inside the plan state; saved plans and plan files carry it.
- `cloud` mode (back end + team + saved plan): rows in the shared tables; Realtime + 30-s polling; `merge` keeps the newest `updatedAt` and drops tasks deleted elsewhere; a newer saved version of the plan triggers a notice.

## Acceptance
tests/phase3.test.js (permissions, overdue, snapshot round trip, merge, cloud calls) · tests/schema.test.mjs (RLS for tasks and comments) · E2E: add task, change status, comment, decision log.
