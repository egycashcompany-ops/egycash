// Operations settings — declared at module load, before boot resolves any value.
import { z } from 'zod';
import { OperationsSettingKeys, objectId } from '@ecms/contracts';
import { declareSetting } from '../../platform/settings';

export const registerOperationsSettings = (): void => {
  declareSetting({
    key: OperationsSettingKeys.CashTransferOperationIds,
    description:
      'Fleet `operation` (التشغيل) catalog ids that mark a vehicle as a cash-transfer vehicle. ' +
      'Empty means no filter — every vehicle is offered to the standing crew.',
    schema: z.array(objectId()).max(50),
    defaultValue: [],
    // ORGANIZATION ONLY. Which vehicles carry cash is a fact about the fleet, not a preference a
    // branch or a user may hold a different opinion about — two branches disagreeing would give
    // two operators two different standing-crew pickers over the same vehicles.
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: OperationsSettingKeys.CrewDepartmentIds,
    description:
      'HR department ids whose employees ARE the operations crew. Each id stands for its ' +
      'company-wide department: every active branch copy of the same catalog entry (or, never ' +
      'linked, of the same name) is crew too, a branch added later included. Empty falls back to ' +
      'whoever already holds a crew-requirements row.',
    // 200, not 50: the card saves every branch copy of each department it ticks, so a choice is
    // still anchored if one branch's copy is deleted — «نقل الأموال» alone is seven ids today, and
    // fifty would have refused a save of a handful of departments across the company's branches.
    schema: z.array(objectId()).max(200),
    defaultValue: [],
    // Organization only: who works in Operations is one fact about the company, not a per-branch
    // opinion — two branches disagreeing would give two planners two different crews.
    allowedScopes: ['organization'],
  });
};
