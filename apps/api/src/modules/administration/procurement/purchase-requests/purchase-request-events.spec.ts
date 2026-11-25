// What a purchase request emits (P2 plan §10.3, §12.1; design §8.4): each helper's payload parses
// against its `…PayloadV1` and carries exactly the catalog's keys — the backstop of the one key per
// line rule, which the platform's publisher scan reads only where each key starts a line. P2.3:
// the submission. The bus is mocked; the catalog is the contracts' own.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdministrationEvents,
  AdministrationPurchaseRequestSubmittedPayloadV1,
  eventCatalogEntry,
} from '@ecms/contracts';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdministrationPurchaseRequestDoc } from './purchase-request.model';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../../../../platform/kernel/event-bus', () => ({ emit: mocks.emit }));

const { announcePurchaseRequestSubmitted } = await import('./purchase-request-events');

const HERE = dirname(fileURLToPath(import.meta.url));
const ID = new Types.ObjectId('64a0000000000000000000f1');
const BRANCH = new Types.ObjectId('64a0000000000000000000b1');
const DEPARTMENT = new Types.ObjectId('64a0000000000000000000d1');
const USER = new Types.ObjectId('64a0000000000000000000a1');
const EMPLOYEE = new Types.ObjectId('64a0000000000000000000e1');

/** A submitted request, as far as an event reads one. */
const submitted = {
  _id: ID,
  number: 'PR-2026-000001',
  status: 'pendingApproval',
  branchId: BRANCH,
  departmentId: DEPARTMENT,
  requesterUserId: USER,
  requesterEmployeeId: EMPLOYEE,
  requesterName: 'منسق الإدارة',
  justification: 'مستلزمات',
  lines: [{ itemCode: 'ITM-00001' }, { itemCode: 'ITM-00002' }],
} as unknown as AdministrationPurchaseRequestDoc;

/** The one emit a helper made: its name and its payload. */
const emitted = (): { name: unknown; payload: Record<string, unknown> } => {
  expect(mocks.emit).toHaveBeenCalledTimes(1);
  const [name, payload] = mocks.emit.mock.calls[0] ?? [];
  return { name, payload: payload as Record<string, unknown> };
};

/** The catalog's top-level fields of one event — what an automation's filter may address. */
const catalogKeys = (name: string): string[] =>
  (eventCatalogEntry(name)?.fields ?? [])
    .filter((field) => !field.path.includes('.'))
    .map((field) => field.path)
    .sort();

beforeEach(() => {
  vi.resetAllMocks();
  mocks.emit.mockResolvedValue(undefined);
});

describe('administration.purchaseRequest.submitted (design §8.2)', () => {
  it('names the submission, and its payload parses against the schema it is catalogued with', async () => {
    await announcePurchaseRequestSubmitted(submitted);
    const { name, payload } = emitted();
    expect(name).toBe(AdministrationEvents.PurchaseRequestSubmitted);
    expect(AdministrationPurchaseRequestSubmittedPayloadV1.parse(payload)).toEqual({
      purchaseRequestId: String(ID),
      number: 'PR-2026-000001',
      branchId: String(BRANCH),
      lineCount: 2,
      departmentId: String(DEPARTMENT),
      requesterUserId: String(USER),
      requesterEmployeeId: String(EMPLOYEE),
    });
  });

  it('carries exactly the catalog’s keys — no name, no free text slipped in beside them', async () => {
    await announcePurchaseRequestSubmitted(submitted);
    const { payload } = emitted();
    expect(Object.keys(payload).sort()).toEqual(
      catalogKeys(AdministrationEvents.PurchaseRequestSubmitted),
    );
    expect(JSON.stringify(payload)).not.toContain('منسق الإدارة');
    expect(JSON.stringify(payload)).not.toContain('مستلزمات');
  });

  it('is emitted as a literal, one key per line, so the publisher scan reads every key', () => {
    const source = readFileSync(join(HERE, 'purchase-request-events.ts'), 'utf8');
    const literal =
      /emit\(AdministrationEvents\.PurchaseRequestSubmitted, \{\n([\s\S]*?)\n {2}\}\);/.exec(
        source,
      );
    expect(literal, 'the emit is a literal').not.toBeNull();
    const keys = (literal?.[1] ?? '').split('\n').map((line) => /^\s+([A-Za-z]+):/.exec(line)?.[1]);
    expect(keys.sort()).toEqual(catalogKeys(AdministrationEvents.PurchaseRequestSubmitted));
  });
});
