// IT settings (design §8.3) — declared at module load, before boot resolves any value.
//
// IT-3 declares the two the help desk consumes. The warranty/license warn windows arrive with the
// slices whose sweeps read them: a setting with no consumer is a knob that does nothing, and this
// module has been careful not to ship those.
import { z } from 'zod';
import { ItSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../platform/settings';

export const registerItSettings = (): void => {
  declareSetting({
    key: ItSettingKeys.SlaAtRiskPercent,
    description:
      'Percentage of the SLA window after which a ticket counts as at risk (a dashboard query — at-risk is never a stored state)',
    schema: z.number().int().min(1).max(100),
    defaultValue: 80,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: ItSettingKeys.TicketAutoCloseDays,
    description:
      'Days a resolved ticket waits before the sweep closes it. 0 disables auto-close entirely',
    schema: z.number().int().min(0).max(365),
    defaultValue: 7,
    allowedScopes: ['organization'],
  });
};
