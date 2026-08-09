// IT settings (design §8.3) — declared at module load, before boot resolves any value.
//
// IT-3 declared the two the help desk consumes; IT-4 added the one its preventive sweep reads;
// IT-5 adds the two warn windows its expiry sweep reads. Every one of the five arrived WITH the
// code that consumes it — a setting with no consumer is a knob that does nothing, and this module
// has been careful not to ship those.
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
  declareSetting({
    key: ItSettingKeys.PreventiveHorizonDays,
    description:
      'How far ahead the preventive sweep looks for due plans. 0 generates orders only once they are already due (§4.6)',
    schema: z.number().int().min(0).max(365),
    defaultValue: 7,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: ItSettingKeys.WarrantyWarnDays,
    description:
      'Days before a warranty ends that it.assetWarranty.expiring fires. 0 disables the early warning; the expired announcement still fires (§4.8)',
    schema: z.number().int().min(0).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: ItSettingKeys.LicenseWarnDays,
    description:
      'Days before a licence expires that it.license.expiring fires. 0 disables the early warning; the expired announcement still fires (§4.8)',
    schema: z.number().int().min(0).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
};
