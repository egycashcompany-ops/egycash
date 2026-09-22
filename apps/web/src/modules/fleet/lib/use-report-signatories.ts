// Who signs a printed Fleet report, read off Fleet settings.
//
// «في إعدادات الحركة» — the names on the signature block are people, and people move. They live
// in the platform's setting registry (declared in `apps/api/.../fleet.settings.ts`, every default
// there rather than here) and arrive resolved through the same `GET /settings/me` the rest of the
// module reads, so an administrator changing one changes every report from the next print on.
//
// The DEFAULT of every key is a real value, so this never has to invent one; the empty strings
// below are what a caller gets for the moment before the request lands, and the print template
// drops a blank line rather than printing an empty office.
import { FleetSettingKeys } from '@ecms/contracts';
import { useMySettings } from '../../../platform/settings/settings-api';
import { type ReportSignatories } from './fleet-report-print';

const EMPTY: ReportSignatories = {
  preparedByTitle: '',
  preparedByName: '',
  approvedByTitle: '',
  approvedByName: '',
  endorsementNote: '',
  endorsedByName: '',
};

export const useReportSignatories = (): ReportSignatories => {
  const { data } = useMySettings();
  if (data === undefined) return EMPTY;
  const value = (key: string): string => {
    const found = data.find((setting) => setting.key === key)?.value;
    return typeof found === 'string' ? found : '';
  };
  return {
    preparedByTitle: value(FleetSettingKeys.ReportPreparedByTitle),
    preparedByName: value(FleetSettingKeys.ReportPreparedByName),
    approvedByTitle: value(FleetSettingKeys.ReportApprovedByTitle),
    approvedByName: value(FleetSettingKeys.ReportApprovedByName),
    endorsementNote: value(FleetSettingKeys.ReportEndorsementNote),
    endorsedByName: value(FleetSettingKeys.ReportEndorsedByName),
  };
};
