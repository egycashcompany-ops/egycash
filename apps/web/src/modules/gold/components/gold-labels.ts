// The module's enum → label helpers, in one place so a metal or a status never reads two ways on
// two screens. Every label is an i18n key; nothing here hard-codes a string in either language.
import {
  type GoldBarStatus,
  type GoldCompanyType,
  type GoldDocumentStatus,
  type GoldMetalType,
} from '@ecms/contracts';
import { type Tone } from '../../../shared/ui/Badge';

type T = (key: string, params?: Record<string, string | number>) => string;

export const metalLabel = (t: T, metal: string): string => t(`gold.metal.${metal}`);
export const barStatusLabel = (t: T, status: GoldBarStatus): string =>
  t(`gold.barStatus.${status}`);
export const docStatusLabel = (t: T, status: GoldDocumentStatus): string =>
  t(`gold.docStatus.${status}`);
export const companyTypeLabel = (t: T, type: GoldCompanyType): string =>
  t(`gold.companyType.${type}`);
export const barActionLabel = (t: T, action: string): string => t(`gold.barAction.${action}`);

/** Draft is in progress, confirmed is done, reverted is undone — the badge says which. */
export const docStatusTone = (status: GoldDocumentStatus): Tone =>
  status === 'confirmed' ? 'success' : status === 'reverted' ? 'neutral' : 'warning';

export const barStatusTone = (status: GoldBarStatus): Tone => {
  if (status === 'in_vault') return 'success';
  if (status === 'delivered' || status === 'transferred') return 'info';
  return 'neutral';
};

export const metalOptions = (t: T): { value: GoldMetalType; label: string }[] =>
  (['gold', 'silver', 'platinum', 'palladium', 'other'] as GoldMetalType[]).map((value) => ({
    value,
    label: metalLabel(t, value),
  }));

export const docStatusOptions = (t: T): { value: GoldDocumentStatus; label: string }[] =>
  (['draft', 'confirmed', 'reverted'] as GoldDocumentStatus[]).map((value) => ({
    value,
    label: docStatusLabel(t, value),
  }));

export const companyTypeOptions = (t: T): { value: GoldCompanyType; label: string }[] =>
  (['company', 'fund', 'institution'] as GoldCompanyType[]).map((value) => ({
    value,
    label: companyTypeLabel(t, value),
  }));
