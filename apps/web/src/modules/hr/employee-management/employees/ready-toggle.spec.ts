// «جاهزون للتعيين» | «المعينون» — A28: «عاوز ال toggle slider يبقا بين جاهزون للتعيين و المعينون و …
// ميكنش ال tggole background اخده الصفحه كلها لا هو عاوزين يبقا اخد مساحه صغيره فوق الزرار بتاع
// المستندات». Read from source where the head needs a live router.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIRED_ROUTE, READY_ROUTE, readyViewOf } from './components/ReadyHeaderActions';

const HERE = dirname(fileURLToPath(import.meta.url));
const code = (path: string): string => readFileSync(resolve(HERE, path), 'utf8').replace(/^\s*\/\/.*$/gm, '');
const HEAD = code('components/ReadyHeaderActions.tsx');
const BAR = code('../../settings/components/SettingsTabBar.tsx');

describe('the small toggle between «جاهزون للتعيين» and «المعينون»', () => {
  it('presses the list the address shows', () => {
    expect(readyViewOf(READY_ROUTE)).toBe('ready');
    expect(readyViewOf(HIRED_ROUTE)).toBe('hired');
    expect(readyViewOf(`${HIRED_ROUTE}/`)).toBe('hired');
    expect(readyViewOf('/employees/ready/anything')).toBe('ready');
  });

  it('is the settings bar in its compact form, the two lists by their own names, «المعينون» for who may print', () => {
    expect(HEAD).toContain('<SettingsTabBar\n          compact');
    expect(HEAD).toContain("label: t('employees.ready.title'), to: READY_ROUTE");
    expect(HEAD).toContain("label: t('employees.hired.title'), to: HIRED_ROUTE");
    expect(HEAD).toContain("can('contract.print')");
  });

  it('sits above the «مستندات الوظائف» button, not across the page', () => {
    expect(HEAD.indexOf('<SettingsTabBar')).toBeLessThan(HEAD.indexOf('data-job-papers-open'));
    expect(HEAD).toContain('flex flex-col items-end gap-2');
    // As wide as its two lists: no full-width strip, no head circle.
    expect(BAR).toContain("'inline-flex items-center rounded-full border p-1'");
    expect(BAR).toContain('{!compact && (');
  });
});
