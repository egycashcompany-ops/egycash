// Publishing an application link happens in one place, and platform management in another.
//
// These two screens answer different questions — "what are candidates asked" and "which platforms
// do they come from" — and the link belongs to the second. It spent a release inside the first,
// where it made the form page do two unrelated jobs and left the owner unable to find any screen
// for managing platforms at all.
//
// A copy would be invisible to typecheck, lint and every behavioural test, because a second
// publish button works perfectly. Only counting the definitions catches it.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../../../');
const LINK_COMPONENT = join(HERE, 'components/SourceLink.tsx');
const FORM_PAGE = resolve(HERE, '../recruitment-form/pages/RecruitmentFormPage.tsx');
const rel = (path: string): string => relative(SRC, path);

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.spec.tsx') ? [full] : [];
  });

const files = sources(SRC).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

describe('application links are managed in exactly one place', () => {
  it('only the source-link component publishes or revokes a link', () => {
    const users = files
      .filter((f) => f.text.includes('useGenerateFormLink') || f.text.includes('useRevokeFormLink'))
      .map((f) => rel(f.path));
    expect(users).toEqual([rel(LINK_COMPONENT)]);
  });

  it('the intake-form page manages fields only — no links, no QR, no copy', () => {
    const page = readFileSync(FORM_PAGE, 'utf8');
    for (const forbidden of [
      'useGenerateFormLink',
      'useRevokeFormLink',
      'recruitmentForm.links',
      'recruitmentForm.generate',
      'recruitmentForm.copy',
      'QRCode',
      'clipboard',
    ]) {
      expect(page, `the form page took link management back (${forbidden})`).not.toContain(forbidden);
    }
    // And it still does its own job.
    expect(page).toContain('recruitmentForm.fields');
  });

  it('the sources page is the screen that renders it', () => {
    const renderers = files
      .filter((f) => f.text.includes('<SourceLink') && f.path !== LINK_COMPONENT)
      .map((f) => rel(f.path));
    expect(renderers).toEqual([rel(join(HERE, 'pages/ApplicantSourcesPage.tsx'))]);
  });

  it('every platform shares one form — the link is the only difference', () => {
    // A per-platform form would have to travel with the link: a form id, a template, a variant.
    // What a link actually carries is a token, and the public page is addressed by that token
    // alone — so there is one form, and the token only says who sent the candidate.
    const contracts = readFileSync(
      resolve(SRC, '../../../packages/contracts/src/modules/hr-recruitment-form.ts'),
      'utf8',
    );
    const dto = /export interface RecruitmentFormLinkDto \{[\s\S]*?\n\}/.exec(contracts)?.[0] ?? '';
    expect(dto, 'RecruitmentFormLinkDto not found').not.toBe('');
    expect(dto).not.toMatch(/formId|templateId|formVariant/);

    const publicApi = readFileSync(
      resolve(HERE, '../recruitment-form/api/recruitment-form-api.ts'),
      'utf8',
    );
    expect(publicApi).toContain('/hr/public/apply/${token}');
  });
});
