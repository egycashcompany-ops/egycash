import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { toEmployeeFileDto } from './employee-file.mapper';
import { type EmployeeFileDoc, type EmployeeTimelineEntry } from './employee-file.model';

const entry = (over: Partial<EmployeeTimelineEntry> = {}): EmployeeTimelineEntry => ({
  at: new Date('2026-09-20T00:00:00.000Z'),
  type: 'applicantRegistered',
  refType: 'applicant',
  refId: new Types.ObjectId(),
  detail: 'APP-2026-000001',
  by: null,
  ...over,
});

const baseDoc = (over: Partial<EmployeeFileDoc> = {}): EmployeeFileDoc =>
  ({
    _id: new Types.ObjectId(),
    employeeId: new Types.ObjectId(),
    employeeCode: 'EMP-2026-000001',
    applicantId: new Types.ObjectId(),
    branchId: new Types.ObjectId(),
    status: 'active',
    links: {
      applicantId: new Types.ObjectId(),
      jobRequisitionId: new Types.ObjectId(),
      screeningId: new Types.ObjectId(),
      interviewIds: [new Types.ObjectId(), new Types.ObjectId()],
      jobOfferId: new Types.ObjectId(),
      hiringDocumentsId: new Types.ObjectId(),
    },
    timeline: [],
    __v: 0,
    createdBy: null,
    updatedBy: null,
    createdAt: new Date('2026-09-20T00:00:00.000Z'),
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    isDeleted: false,
    ...over,
  }) as unknown as EmployeeFileDoc;

describe('toEmployeeFileDto', () => {
  it('maps status, version, and the linked recruitment history as string ids', () => {
    const doc = baseDoc();
    const dto = toEmployeeFileDto(doc);
    expect(dto.status).toBe('active');
    expect(dto.employeeCode).toBe('EMP-2026-000001');
    expect(dto.version).toBe(0);
    expect(dto.links.applicantId).toBe(String(doc.links.applicantId));
    expect(dto.links.jobRequisitionId).toBe(String(doc.links.jobRequisitionId));
    expect(dto.links.screeningId).toBe(String(doc.links.screeningId));
    expect(dto.links.interviewIds).toEqual(doc.links.interviewIds.map((id) => String(id)));
    expect(dto.links.jobOfferId).toBe(String(doc.links.jobOfferId));
    expect(dto.links.hiringDocumentsId).toBe(String(doc.links.hiringDocumentsId));
  });

  it('nulls optional links when absent (incl. a direct-intake Job Request)', () => {
    const doc = baseDoc({
      links: {
        applicantId: new Types.ObjectId(),
        jobRequisitionId: null,
        screeningId: null,
        interviewIds: [],
        jobOfferId: null,
        hiringDocumentsId: new Types.ObjectId(),
      },
    });
    const dto = toEmployeeFileDto(doc);
    expect(dto.links.jobRequisitionId).toBeNull();
    expect(dto.links.screeningId).toBeNull();
    expect(dto.links.jobOfferId).toBeNull();
    expect(dto.links.interviewIds).toEqual([]);
  });

  it('maps timeline entries with ISO dates and string refs, nulling ref/by where absent', () => {
    const refId = new Types.ObjectId();
    const author = new Types.ObjectId();
    const doc = baseDoc({
      timeline: [
        entry({ type: 'interviewPassed', refType: 'interview', refId, detail: 'First Interview' }),
        entry({
          at: new Date('2026-09-25T10:00:00.000Z'),
          type: 'note',
          refType: null,
          refId: null,
          detail: 'Welcome aboard',
          by: author,
        }),
      ],
    });
    const dto = toEmployeeFileDto(doc);
    expect(dto.timeline).toHaveLength(2);
    expect(dto.timeline[0]).toMatchObject({
      type: 'interviewPassed',
      refType: 'interview',
      refId: String(refId),
      detail: 'First Interview',
      at: '2026-09-20T00:00:00.000Z',
      by: null,
    });
    expect(dto.timeline[1]).toMatchObject({
      type: 'note',
      refType: null,
      refId: null,
      detail: 'Welcome aboard',
      at: '2026-09-25T10:00:00.000Z',
      by: String(author),
    });
  });
});
