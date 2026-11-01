// The two day signals (DS-26; docs/12-planning/atm-settlements-phase1.md §6.11).
//
// Topic rooms are joined only by holders of the topic's key, and the Preparation and Control
// bundles hold neither `atmSettlementPlan.view` nor `atmPreparation.view`; audit signals carry no
// branch either (G-11). So after the commits that change what those pages show, the service also
// sends one signal on a topic of their own WITH the plan's branch, which reaches branch rooms too
// (`realtime-publisher.ts`). No audit row of their own — the `fleet/custody/custody-memo-guard.ts`
// precedent. Each call is written with its literal `{ moduleId: 'atm', entityType: '…' }` pair so
// the registry spec's source scan finds both topics. Best-effort, as every signal is.
import { publishAuditedChange } from '../../../../platform/realtime';

/** After S18, S19 and S20: Preparation's lists change. */
export const signalPreparationDay = (planId: string, branchId: string): void => {
  publishAuditedChange({
    entityRef: { moduleId: 'atm', entityType: 'preparationDay', entityId: planId },
    action: 'update',
    at: new Date().toISOString(),
    branchId,
  });
};

/** After S18, S19, S20, P3, P4, P5 and C6: Control's day changes. */
export const signalControlDay = (planId: string, branchId: string): void => {
  publishAuditedChange({
    entityRef: { moduleId: 'atm', entityType: 'controlDay', entityId: planId },
    action: 'update',
    at: new Date().toISOString(),
    branchId,
  });
};
