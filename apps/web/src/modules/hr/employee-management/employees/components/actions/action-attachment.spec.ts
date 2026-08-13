// Structural invariants of an action's supporting document (HR3-C).
//
// One of these matters far more than the rest: the client must upload through the MODULE's
// endpoint, never through the generic `/platform/files` one. The module endpoint sets the entity
// reference server-side, and that reference is the entire basis of the ADR-023 answer — a client
// that could name its own would be a client that could file a document under any employee it
// liked. The rest is ordering: the upload has to finish before the action is created, because an
// action cannot be edited afterwards.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Locale } from '@ecms/contracts';
import { translate } from '../../../../../../platform/localization/i18n';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (file: string): string => readFileSync(resolve(HERE, file), 'utf8');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');

const SHELL = stripComments(read('./ActionDialog.tsx'));
const API = stripComments(read('../../api/employee-api.ts'));
const QUERIES = stripComments(read('../../api/employee-queries.ts'));
const HISTORY = stripComments(read('../ActionHistory.tsx'));
const DIALOG_FILES = ['./CareerDialogs.tsx', './LifecycleDialogs.tsx', './ExitRehireDialogs.tsx'];

describe('the upload goes through the module, not the file service', () => {
  it('posts to the actions attachment endpoint', () => {
    expect(API).toContain('/actions/attachment');
  });

  /**
   * The generic endpoint takes `moduleId` / `entityType` / `entityId` as multipart FIELDS — from
   * the caller. Naming any of them here would mean the browser decides who owns the document.
   */
  it('and never to the generic files endpoint, nor names an entity reference', () => {
    expect(API).not.toContain("upload<FileDto>('/platform/files");
    expect(API).not.toContain('entityType');
    expect(API).not.toContain('entityId');
  });
});

describe('the document is ready before the action is created', () => {
  // Uploaded when picked. An action is immutable once written, so "attach afterwards" is not an
  // option the server offers — by submit time the id must already exist.
  it('uploads on pick and keeps the id, not the File', () => {
    expect(SHELL).toContain('attach.mutate(file, {');
    expect(SHELL).toContain('setAttachment({ id: uploaded.id, name: file.name })');
  });

  it('and puts that id into the body every dialog submits', () => {
    expect(SHELL).toContain('attachmentFileId: attachment.id');
  });

  // The hook cannot upload for an employee it was not told about.
  it('every dialog hands the shared fields its employee', () => {
    for (const file of DIALOG_FILES) {
      const source = stripComments(read(file));
      const calls = (source.match(/useActionCommonFields\(/g) ?? []).length;
      const withId = (source.match(/useActionCommonFields\(employee\.id\)/g) ?? []).length;
      expect(calls, file).toBeGreaterThan(0);
      expect(withId, file).toBe(calls);
    }
  });

  it('the upload invalidates nothing — the file belongs to no action yet', () => {
    const hook = QUERIES.slice(
      QUERIES.indexOf('export const useAttachActionDocument'),
      QUERIES.indexOf('const useInvalidateAfterAction'),
    );
    expect(hook.length).toBeGreaterThan(0);
    expect(hook).not.toContain('invalidateQueries');
  });
});

describe('the history says a document is there', () => {
  it('renders the attachment column from the DTO field', () => {
    expect(HISTORY).toContain('a.attachmentFileId === null');
  });

  // Reaching the bytes is the Files service's business, and no download surface exists for these
  // yet — claiming one in a link that goes nowhere would be worse than saying only "attached".
  it('and offers no download it cannot deliver', () => {
    expect(HISTORY).not.toContain('download');
    expect(HISTORY).not.toContain('/platform/files');
  });
});

describe('both locales can say it', () => {
  const KEYS = [
    'employees.actions.attachment',
    'employees.actions.attachmentPick',
    'employees.actions.attachmentPresent',
  ];

  it('resolves in Arabic and English', () => {
    for (const locale of ['ar', 'en'] as Locale[]) {
      for (const key of KEYS) {
        expect(translate(locale, key), `${locale}:${key}`).not.toBe(key);
      }
    }
  });

  it('and says something different in each', () => {
    for (const key of KEYS) {
      expect(translate('ar', key), key).not.toBe(translate('en', key));
    }
  });
});
