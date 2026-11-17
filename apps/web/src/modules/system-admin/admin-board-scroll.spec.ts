// «عايز بردو كل الصفحات اللى فى مديول الإدارة ميبقاش الصفحات كلها بتعمل Scroll لكن الجداول بس».
//
// Every page of the Administration menu takes the board frame (`shared/ui/board-scroll.ts`): on a
// computer the title, tabs and filters keep their place, the pager stays below, and only the table
// — or, on a page whose list is cards, only that list — scrolls. The suite has no DOM to measure a
// scroll in, so this holds each page to the shape the frame needs; the real scrolling was checked
// in a browser when the frame was applied.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODULES = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The Administration menu (`seed-navigation.ts`, category «الإدارة»), page by page. */
const TABLE_PAGES = [
  'system-admin/users/pages/UsersListPage.tsx',
  'system-admin/active-users/pages/ActiveUsersPage.tsx',
  'system-admin/notification-templates/pages/TemplatesListPage.tsx',
  'system-admin/audit/pages/AuditLogPage.tsx',
  'system-admin/audit/pages/ActivityLogPage.tsx',
  'organization/applications/pages/ApplicationsListPage.tsx',
  'organization/application-categories/pages/ApplicationCategoriesListPage.tsx',
] as const;

/** Pages whose list is cards or grouped rows rather than a table. */
const LIST_PAGES = [
  'system-admin/roles/pages/RolesListPage.tsx',
  'system-admin/roles/pages/PermissionCatalogPage.tsx',
  'system-admin/approvals/pages/ApprovalWorkflowsPage.tsx',
  'system-admin/settings/pages/SettingsPage.tsx',
] as const;

const source = (path: string): string => readFileSync(resolve(MODULES, path), 'utf8');

describe('every Administration page scrolls its table, not itself', () => {
  it.each([...TABLE_PAGES, ...LIST_PAGES])('%s fills the screen inside the board frame', (path) => {
    const code = source(path);
    expect(code).toContain('<PageContainer fullHeight>');
    expect(code).toContain('className={BOARD_FRAME}');
  });

  it.each(TABLE_PAGES)('%s: the table takes the height left, under a head that stays', (path) => {
    const code = source(path);
    expect(code).toContain('className={BOARD_TABLE_FILL}');
    expect(code).toMatch(/<DataTable[\s\S]*?\bstickyHead\b/);
  });

  it.each(LIST_PAGES)('%s: the list region takes the height left and scrolls', (path) => {
    expect(source(path)).toMatch(/className=\{(?:cn\()?BOARD_LIST_FILL/);
  });
});
