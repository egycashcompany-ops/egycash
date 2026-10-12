// «إجمالي العهدة» — the fund itself, beside what it paid for: «عاوز ازود اجمالى العهده فى الاحصايات و
// تكون فى الداس بورد».
//
// Read HERE, by the server, under the custody screen's own grant (`fleetCustody.view`): the figures
// and the dashboard carry it, so whoever may see what the fund spent sees the fund too, with no
// settings permission of their own — `GET /settings/me` is not the custody screen's to ask. The
// organization's value only: the fund is the department's, so no branch or user override of it
// exists (the setting allows the organization scope alone) and none is asked for.
import { FleetSettingKeys, fleetCustodyFundTotal } from '@ecms/contracts';
import { settingsService } from '../../../platform/settings';

const ORGANIZATION = { userId: null, branchId: null } as const;

/** The fund in EGP, or `null` while «مبلغ العهدة» is not set (0). */
export const readCustodyFundTotal = async (): Promise<number | null> =>
  fleetCustodyFundTotal(
    await settingsService.resolve<number>(FleetSettingKeys.CustodyFundTotal, ORGANIZATION),
  );
