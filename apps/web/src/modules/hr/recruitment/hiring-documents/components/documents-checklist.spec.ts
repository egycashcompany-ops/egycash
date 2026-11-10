// «مستندات التعيين» (A27, stage 3) — the documents checklist is the employee's job's: a type another
// job collects is not asked of this one, and a document already uploaded is never hidden.
import { describe, expect, it } from 'vitest';
import { type HiringDocumentTypeDto, type HiringDocumentsDto } from '@ecms/contracts';
import { buildRows } from './DocumentsList';

const type = (key: string, over: Partial<HiringDocumentTypeDto> = {}): HiringDocumentTypeDto => ({
  id: `id-${key}`,
  key,
  name: { ar: key, en: key },
  required: true,
  active: true,
  allJobs: true,
  jobTitleIds: [],
  version: 0,
  ...over,
});

const set = (typeKeys: string[], uploaded: string[] = []): HiringDocumentsDto =>
  ({
    id: 'set',
    typeKeys,
    missingRequired: [],
    documents: uploaded.map((key) => ({
      typeId: `id-${key}`,
      typeKey: key,
      typeName: { ar: key, en: key },
      required: true,
      fileId: `file-${key}`,
      fileName: `${key}.pdf`,
      fileVersion: 1,
      notes: null,
      uploadedBy: null,
      uploadedAt: '2026-11-15T00:00:00.000Z',
    })),
  }) as unknown as HiringDocumentsDto;

const TYPES = [type('employmentContract'), type('weaponDeclaration', { allJobs: false, jobTitleIds: ['leader'] })];

describe('the documents checklist', () => {
  it('lists only what the employee\'s job collects', () => {
    expect(buildRows(set(['employmentContract']), TYPES).map((r) => r.typeId)).toEqual(['id-employmentContract']);
    expect(buildRows(set(['employmentContract', 'weaponDeclaration']), TYPES).map((r) => r.typeId)).toEqual([
      'id-employmentContract',
      'id-weaponDeclaration',
    ]);
  });

  it('still shows a document uploaded under a type the job no longer collects', () => {
    const rows = buildRows(set(['employmentContract'], ['weaponDeclaration']), TYPES);
    expect(rows.map((r) => r.typeId)).toEqual(['id-employmentContract', 'id-weaponDeclaration']);
    expect(rows[1]?.doc?.fileName).toBe('weaponDeclaration.pdf');
  });
});
