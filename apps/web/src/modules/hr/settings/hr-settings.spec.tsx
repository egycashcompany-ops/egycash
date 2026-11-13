// «الإعدادات» — one HR page whose tabs are the six configuration screens.
//
// «عايز الجزء اللى فالصورة دا يبقي جوا صفحة واحده أسمها إعدادات وتبقي فوق خالص وتظهر جوا زى المنيو
// بتاع الرئيسية فى الحركة». The bar is rendered for real (in both of its halves: a reader holding
// every section, and one holding a single section); the wiring — the guards, the redirects from the
// old addresses, the way back from each screen — is checked in the source it lives in.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { HR_SETTINGS_HUB, type Locale, type MeDto } from '@ecms/contracts';
import { localeSlice } from '../../../store/localeSlice';
import { authSlice } from '../../../store/authSlice';
import { translate } from '../../../platform/localization/i18n';
import { HrSettingsLayout } from './HrSettingsLayout';
import { SETTINGS_SCREENS } from './routes';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../..');
/**
 * Prose may describe the old wiring; only CODE may still perform it. A block comment is taken only
 * where one can start — a JSX `{/* … *\/}` or the head of a line — because a route path such as
 * `"/hr-settings/*"` holds the same two characters.
 */
const code = (path: string): string =>
  readFileSync(resolve(SRC, path), 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
    .replace(/(^|\s)\/\/.*$/gm, '');

const ALL = HR_SETTINGS_HUB.tabs.map((tab) => tab.permission);

const bar = (permissions: readonly string[], url: string): string =>
  renderToStaticMarkup(
    <Provider
      store={configureStore({
        reducer: { locale: localeSlice.reducer, auth: authSlice.reducer },
        preloadedState: {
          locale: { locale: 'ar' as Locale, dir: 'rtl' as const },
          auth: {
            me: {
              id: 'u1',
              permissions: Object.fromEntries(permissions.map((k) => [k, 'organization'])),
            } as unknown as MeDto,
            status: 'signedIn' as const,
          },
        },
      })}
    >
      <MemoryRouter initialEntries={[url]}>
        <HrSettingsLayout />
      </MemoryRouter>
    </Provider>,
  );

const links = (html: string): string[] =>
  [...html.matchAll(/data-settings-tab="([^"]+)"/g)].map((m) => m[1] as string);

describe('the bar', () => {
  it('offers every section, in the order of the two sidebar groups it replaced', () => {
    const html = bar(ALL, '/hr-settings/recruitment-form');
    expect(links(html)).toEqual([
      'recruitment-form',
      // «جمب نموزج التقديم» — what «نموذج رقم (1)» prints for a job.
      'insurance-job-titles',
      'applicant-sources',
      'interview-stages',
      'evaluation-phases',
      'announcements',
      'notification-rules',
    ]);
    for (const tab of HR_SETTINGS_HUB.tabs) {
      expect(html).toContain(`href="/hr-settings/${tab.key}"`);
      expect(html).toContain(translate('ar', `hr.settings.tab.${tab.key}`));
    }
    // The two groups, named as the sidebar named them, with one divider between them.
    expect(html).toContain('aria-label="إعدادات التوظيف"');
    expect(html).toContain('aria-label="التواصل"');
    expect(html.match(/w-px/g)).toHaveLength(1);
  });

  it('marks the open section — and paints it pressed until the pill is measured', () => {
    const html = bar(ALL, '/hr-settings/applicant-sources');
    const open = /<a[^>]*aria-current="page"[^>]*>/.exec(html)?.[0] ?? '';
    expect(open).toContain('data-settings-tab="applicant-sources"');
    expect(open).toContain('bg-brand-600');
    expect(open).toContain('text-white');
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    // The pill exists, and stays invisible until it has somewhere to be.
    expect(html).toMatch(/data-settings-glider="true"[^>]*opacity-0|opacity-0[^>]*data-settings-glider/);
  });

  it('wears the Fleet bar: the white strip, the brand circle at its head', () => {
    const html = bar(ALL, '/hr-settings/announcements');
    expect(html).toContain('rounded-full border');
    expect(html).toContain('dark:bg-[#121a2a]');
    expect(html).toContain('bg-brand-600 text-white shadow-md shadow-brand-700/30');
  });

  it('shows a reader only the sections he holds', () => {
    const html = bar(['announcement.send'], '/hr-settings/announcements');
    expect(links(html)).toEqual(['announcements']);
    // One group left, so no divider and no empty recruitment group.
    expect(html).not.toContain('w-px');
    expect(html).not.toContain('إعدادات التوظيف');
  });

  it('presses nothing on an address that is no section', () => {
    expect(bar(ALL, '/hr-settings/nope')).not.toContain('aria-current="page"');
  });
});

describe('the routes', () => {
  const ROUTES = code('modules/hr/settings/routes.tsx');

  it('gives every tab its screen', () => {
    expect(Object.keys(SETTINGS_SCREENS).sort()).toEqual(
      HR_SETTINGS_HUB.tabs.map((tab) => tab.key).sort(),
    );
  });

  it('guards each tab by its own key, and the page by any of them', () => {
    expect(ROUTES).toContain('<RequirePermission permission={tab.permission}>');
    expect(ROUTES).toContain('<RequirePermission anyOf={hubPermissions(HR_SETTINGS_HUB.route)}>');
    expect(ROUTES).toContain('path={tab.key}');
  });

  it('is mounted under its own address', () => {
    expect(code('platform/app/App.tsx')).toContain('path="/hr-settings/*"');
  });
});

describe('the old addresses', () => {
  it('send a bookmark to the same screen, now a tab', () => {
    const app = code('platform/app/App.tsx');
    expect(app).toContain('<Navigate to="/hr-settings/announcements" replace />');
    expect(app).toContain('<Navigate to="/hr-settings/notification-rules" replace />');
    expect(app).not.toContain('<AnnouncementRoutes');
    expect(app).not.toContain('<NotificationRuleRoutes');

    const recruitment = code('modules/hr/recruitment/routes.tsx');
    expect(recruitment).toContain('<Navigate to="/hr-settings/recruitment-form" replace />');
    expect(recruitment).toContain('<Navigate to="/hr-settings/applicant-sources" replace />');
    expect(recruitment).toContain('<Navigate to="/hr-settings/interview-stages" replace />');
    expect(recruitment).toContain('<Navigate to="/hr-settings/evaluation-phases" replace />');
    // The screens themselves are rendered in one place only.
    for (const screen of [
      '<RecruitmentFormPage',
      '<ApplicantSourcesPage',
      '<InterviewStagesPage',
      '<EvaluationPhasesPage',
    ]) {
      expect(recruitment).not.toContain(screen);
    }
  });
});

describe('each screen leads back to «الإعدادات»', () => {
  it.each([
    'modules/hr/recruitment/recruitment-form/pages/RecruitmentFormPage.tsx',
    'modules/hr/recruitment/applicant-sources/pages/ApplicantSourcesPage.tsx',
    'modules/hr/recruitment/interviews/pages/InterviewStagesPage.tsx',
    'modules/hr/recruitment/evaluations/pages/EvaluationPhasesPage.tsx',
    'modules/hr/announcements/pages/ComposeAnnouncementPage.tsx',
    'modules/hr/notification-rules/pages/NotificationRulesPage.tsx',
  ])('%s', (page) => {
    expect(code(page)).toContain("{ label: t('hr.settings.title'), to: '/hr-settings' }");
  });
});

describe('translations', () => {
  it('names the page, its groups and every section in both languages', () => {
    const keys = [
      'hr.settings.title',
      'hr.settings.navLabel',
      'hr.settings.group.recruitment',
      'hr.settings.group.communication',
      ...HR_SETTINGS_HUB.tabs.map((tab) => `hr.settings.tab.${tab.key}`),
    ];
    for (const key of keys) {
      expect(translate('ar', key), key).not.toBe(key);
      expect(translate('en', key), key).not.toBe(key);
    }
    expect(translate('ar', 'hr.settings.title')).toBe('الإعدادات');
  });
});
