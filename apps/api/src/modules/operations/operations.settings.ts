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
};
