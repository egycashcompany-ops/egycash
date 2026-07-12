import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { computeMissingRequired, toHiringDocumentsDto } from './hiring-documents.mapper';
import { type HiringDocumentItem, type HiringDocumentsDoc } from './hiring-documents.model';

const item = (over: Partial<HiringDocumentItem> = {}): HiringDocumentItem => ({
  typeId: new Types.ObjectId(),
  typeKey: 'signedContract',
  typeName: { ar: 'عقد', en: 'Contract' },
  required: true,
  fileId: new Types.ObjectId(),
  fileName: 'contract.pdf',
  fileVersion: 1,
  notes: null,
  uploadedBy: new Types.ObjectId(),
  uploadedAt: new Date('2026-09-20T00:00:00.000Z'),
  ...over,
});

const baseDoc = (over: Partial<HiringDocumentsDoc> = {}): HiringDocumentsDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    employeeCode: 'EMP-2026-000001',
    applicantId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    managerId: new Types.ObjectId(),
    status: 'inProgress',
    documents: [],
    completedAt: null,
    completedBy: null,
    __v: 0,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...over,
  }) as HiringDocumentsDoc;

describe('computeMissingRequired', () => {
  it('lists active required keys not yet uploaded', () => {
    const doc = baseDoc({ documents: [item({ typeKey: 'signedContract' })] });
    expect(computeMissingRequired(doc, ['signedContract', 'nationalIdCopy', 'personalPhoto'])).toEqual([
      'nationalIdCopy',
      'personalPhoto',
    ]);
  });

  it('is empty when every required document is present', () => {
    const doc = baseDoc({
      documents: [item({ typeKey: 'signedContract' }), item({ typeKey: 'nationalIdCopy' })],
    });
    expect(computeMissingRequired(doc, ['signedContract', 'nationalIdCopy'])).toEqual([]);
  });
});

describe('toHiringDocumentsDto', () => {
  it('maps status, document metadata (type/name/uploader/date/version), and missingRequired', () => {
    const uploader = new Types.ObjectId();
    const doc = baseDoc({
      documents: [item({ typeKey: 'signedContract', fileVersion: 2, fileName: 'contract-v2.pdf', uploadedBy: uploader })],
    });
    const dto = toHiringDocumentsDto(doc, ['nationalIdCopy']);
    expect(dto.status).toBe('inProgress');
    expect(dto.employeeCode).toBe('EMP-2026-000001');
    expect(dto.missingRequired).toEqual(['nationalIdCopy']);
    expect(dto.documents).toHaveLength(1);
    expect(dto.documents[0]).toMatchObject({
      typeKey: 'signedContract',
      typeName: { ar: 'عقد', en: 'Contract' },
      required: true,
      fileName: 'contract-v2.pdf',
      fileVersion: 2,
      uploadedBy: String(uploader),
      uploadedAt: '2026-09-20T00:00:00.000Z',
    });
  });

  it('surfaces the completion timestamp once completed', () => {
    const dto = toHiringDocumentsDto(
      baseDoc({ status: 'completed', completedAt: new Date('2026-09-25T00:00:00.000Z') }),
      [],
    );
    expect(dto.status).toBe('completed');
    expect(dto.completedAt).toBe('2026-09-25T00:00:00.000Z');
  });
});
