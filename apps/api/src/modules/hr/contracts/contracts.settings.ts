// Contracts settings (frozen design A1/A7/D11) — declared at module load, before boot
// resolves any value.
import { z } from 'zod';
import { HrContractSettingKeys } from '@ecms/contracts';
import { declareSetting } from '../../../platform/settings';
import { DEFAULT_CONTRACT_NUMBER_FORMAT } from './contracts/contract-number';

export const registerHrContractSettings = (): void => {
  declareSetting({
    key: HrContractSettingKeys.NumberFormat,
    description: 'Contract number pattern: {prefix}-free text with {year} and {seq[:pad]} tokens',
    schema: z.string().min(3).max(60).regex(/\{seq(:\d{1,2})?\}/),
    defaultValue: DEFAULT_CONTRACT_NUMBER_FORMAT,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrContractSettingKeys.RequireApproval,
    description: 'Require the approval gate before a contract can be generated',
    schema: z.boolean(),
    defaultValue: true,
    allowedScopes: ['organization'],
  });
  declareSetting({
    key: HrContractSettingKeys.ExpiryNoticeDays,
    description: 'Days before a fixed-term contract ends to notify contract viewers',
    schema: z.number().int().min(1).max(365),
    defaultValue: 30,
    allowedScopes: ['organization'],
  });
};
