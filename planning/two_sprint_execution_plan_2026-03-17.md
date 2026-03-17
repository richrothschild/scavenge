# SCAVENGE Two Sprint Execution Plan

Date created: 2026-03-17
Plan owner: Tech Lead
Event date: 2026-04-11

## Sprint Windows

- Sprint 1: 2026-03-18 to 2026-03-27
- Sprint 2: 2026-03-30 to 2026-04-08
- Stabilization and release freeze: 2026-04-09 to 2026-04-10

## Owner Map

- Tech Lead: scope, sequencing, approvals
- Backend Engineer: backend routes, persistence, policy enforcement
- Admin Frontend Engineer: admin setup and live-ops UX
- Mobile Engineer: mobile resilience and offline/retry behavior
- QA Automation Engineer: backend integration and Playwright e2e
- DevOps Engineer: deploy gates, smoke/synthetic checks, alerting
- Product Ops Lead: game-day runbook, rehearsal ownership, go/no-go

## Sprint 1 Goal

Lock down game integrity and operator safety for core gameplay and admin mutations.

## Sprint 1 Exit Criteria

- All Sprint 1 stories complete and deployed to production.
- Backend tests and admin e2e are green on main.
- Production smoke passes with no manual intervention.
- No P0 or P1 defects open in policy enforcement or admin assignment flow.

## Sprint 2 Goal

Deliver game-day operational reliability with incident controls, observability, and rehearsed procedures.

## Sprint 2 Exit Criteria

- Incident controls, dashboard, and fallback paths are production-validated.
- Synthetic checks for critical user and admin journeys run on schedule.
- Full rehearsal completed in under 60 minutes with no P1 blockers.
- Rollback package validated and documented.

## Scope Boundaries

In scope:
- Player join/resume/reconnect behavior
- Captain assignment and handoff safety
- Admin mutation reliability and traceability
- Incident controls and operations visibility

Out of scope for this cycle:
- Net-new game mechanics
- Major visual redesign
- Non-critical refactors not tied to game-day risk

## Delivery Rhythm

- Daily: owner check-in and blocker sweep
- Tue/Thu: integration test and deploy preview checkpoint
- End of each sprint: production rollout plus smoke and synthetic verification

## Risk Triggers and Escalation

- Trigger: two failed deploys in a row for backend or web
  - Action: freeze feature merges, run rollback, root-cause within 2 hours
- Trigger: admin mutation endpoint error rate above 2 percent for 10 minutes
  - Action: switch to incident mode DEGRADED, notify Product Ops Lead
- Trigger: realtime disconnect rate above 5 percent sustained for 15 minutes
  - Action: force polling fallback and post operator banner

## Definition of Done for Every Story

- Feature flag or guard behavior documented where applicable.
- Tests cover happy path and at least one failure mode.
- Audit log entries are present for all admin mutations.
- OpenAPI updated when route contracts change.
- Runbook updated for any new operational control.
