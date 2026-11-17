// The company letterhead the hiring forms wear (A27): the company's name and «إدارة الموارد
// البشرية» at the start of the line, the EGYCASH logo opposite — the same letterhead every paper the
// browser prints carries (the logo is one shared file, `@ecms/contracts/egycash-logo`).
import { EGYCASH_LOGO } from '@ecms/contracts/egycash-logo';
import { organizationService } from '../../../../platform/organization';
import { type Letterhead } from './contract-render';

export const letterheadFor = async (language: 'ar' | 'en'): Promise<Letterhead> => {
  const org = await organizationService.get().catch(() => null);
  const name = org?.name as { ar?: string; en?: string } | string | undefined;
  const company = typeof name === 'string' ? name : (name?.[language] ?? '');
  return {
    logoDataUri: EGYCASH_LOGO,
    lines: [company, language === 'ar' ? 'إدارة الموارد البشرية' : 'Human Resources'].filter(
      (line) => line.trim() !== '',
    ),
  };
};
