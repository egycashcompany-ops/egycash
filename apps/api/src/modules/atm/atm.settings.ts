// ATM settings — declared at module load, before boot resolves any value.
import { z } from 'zod';
import { AtmSettingKeys, objectId } from '@ecms/contracts';
import { declareSetting } from '../../platform/settings';

export const registerAtmSettings = (): void => {
  declareSetting({
    key: AtmSettingKeys.MaintenanceLeaderDepartmentIds,
    description:
      'HR department ids whose employees populate the maintenance close-modal assignee list. ' +
      'The legacy hardcoded the department NAME "الصراف الالى" (contad_app.js:1110-1112); the ' +
      'org chart owns names here, so the constant became configuration. Empty means the modal ' +
      'offers nobody and maintenance cannot be closed until it is set.',
    schema: z.array(objectId()).max(50),
    defaultValue: [],
    // Organization only: who staffs the ATM department is one fact about the company, not a
    // per-branch opinion (the operations CrewDepartmentIds precedent).
    allowedScopes: ['organization'],
  });
};
