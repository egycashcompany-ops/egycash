// «حفظ العقد» as one ordered sequence: the contract first, then its files one by one in the tray's
// order, then — on an edit — the order, only when it differs. A refused contract sends nothing
// else; a failed file never undoes the contract; a cancelled file is simply not added. A new
// contract's «المستلم حتى الآن» rides in the create body itself (the server records it as the first
// delivery), so no delivery call follows.
import { describe, expect, it } from 'vitest';
import { type FleetVehicleContractDto, type FleetVehicleContractFileDto } from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  saveContractWithFiles,
  type ContractSaveApi,
  type TrayItem,
} from './vehicle-contract-save';

const fileDto = (fileId: string, fileName = `${fileId}.png`): FleetVehicleContractFileDto => ({
  fileId,
  fileName,
  mime: 'image/png',
  size: 1000,
  kind: 'image',
  addedAt: '2026-10-19T08:00:00.000Z',
});
const contract = (files: FleetVehicleContractFileDto[] = []) =>
  ({ id: 'c-1', files, version: 1 }) as unknown as FleetVehicleContractDto;
const local = (name: string): File => new File(['x'], name, { type: 'image/png' });
const pending = (key: string): TrayItem => ({
  kind: 'pending',
  key,
  file: local(`${key}.png`),
  progress: null,
});
const saved = (file: FleetVehicleContractFileDto): TrayItem => ({
  kind: 'saved',
  key: file.fileId,
  file,
});

/** The api, recording every call in order; `fail` names the uploads that are refused. */
const fakeApi = (
  fail: string[] = [],
  abort: string[] = [],
): { api: ContractSaveApi; calls: string[] } => {
  const calls: string[] = [];
  let uploaded = 0;
  return {
    calls,
    api: {
      create: async () => {
        calls.push('create');
        return contract();
      },
      update: async (_id, body) => {
        calls.push(`update v${body.version}`);
        return contract();
      },
      upload: async (_id, file, options) => {
        calls.push(`upload ${file.name}`);
        options.onProgress?.(50);
        if (abort.includes(file.name)) throw new DOMException('cancelled', 'AbortError');
        if (fail.includes(file.name)) throw new ApiError('FILE_TOO_LARGE', 'big', 422);
        uploaded += 1;
        return fileDto(`n${uploaded}`, file.name);
      },
      removeFile: async (_id, fileId) => {
        calls.push(`remove ${fileId}`);
      },
      order: async (_id, fileIds) => {
        calls.push(`order ${fileIds.join(',')}`);
        return contract();
      },
    },
  };
};

const BODY = {
  name: '',
  date: new Date('2026-10-19'),
  deadline: null,
  supplier: '',
  lines: [{ id: null, typeId: 't-1', count: 2, unitPrice: null }],
};
/** A new contract's body: nothing received yet («المستلم حتى الآن» 0, no day). */
const CREATE_BODY = {
  ...BODY,
  lines: BODY.lines.map((line) => ({ ...line, received: 0 })),
  receivedDate: null,
};

describe('a new contract', () => {
  it('cars already received go in the one create — no delivery call follows', async () => {
    const { api, calls } = fakeApi();
    const sent: unknown[] = [];
    const create = api.create;
    api.create = async (body) => {
      sent.push(body);
      return create(body);
    };
    const body = {
      ...BODY,
      lines: [{ ...BODY.lines[0]!, received: 2 }],
      receivedDate: new Date('2026-11-01'),
    };
    await saveContractWithFiles(api, { mode: 'create', body, items: [pending('p1')] });
    expect(sent).toEqual([body]);
    expect(calls).toEqual(['create', 'upload p1.png']);
  });

  it('is created, then its files go up one by one in the order the tray shows', async () => {
    const { api, calls } = fakeApi();
    const progress: string[] = [];
    const result = await saveContractWithFiles(
      api,
      { mode: 'create', body: CREATE_BODY, items: [pending('p3'), pending('p1'), pending('p2')] },
      { onProgress: (key, percent) => progress.push(`${key}:${percent}`) },
    );
    expect(calls).toEqual(['create', 'upload p3.png', 'upload p1.png', 'upload p2.png']);
    expect(progress).toEqual(['p3:50', 'p1:50', 'p2:50']);
    expect(result).toMatchObject({ failed: [], orderRefused: false });
  });

  it('a file that fails is named, and the contract is kept; a cancelled one is just dropped', async () => {
    const { api, calls } = fakeApi(['p1.png'], ['p2.png']);
    const result = await saveContractWithFiles(api, {
      mode: 'create',
      body: CREATE_BODY,
      items: [pending('p1'), pending('p2'), pending('p3')],
    });
    expect(calls).toEqual(['create', 'upload p1.png', 'upload p2.png', 'upload p3.png']);
    expect(result.failed).toEqual(['p1.png']);
    expect(result.contract.id).toBe('c-1');
  });

  it('a refused contract sends nothing else', async () => {
    const { api, calls } = fakeApi();
    api.create = async () => {
      calls.push('create');
      throw new ApiError('BUSINESS_RULE_VIOLATION', 'no', 422, [
        { field: 'lines.0.typeId', code: 'INACTIVE_TYPE', message: 'x' },
      ]);
    };
    await expect(
      saveContractWithFiles(api, { mode: 'create', body: CREATE_BODY, items: [pending('p1')] }),
    ).rejects.toMatchObject({ status: 422 });
    expect(calls).toEqual(['create']);
  });
});

describe('an edit', () => {
  const a = fileDto('a');
  const b = fileDto('b');
  const c = fileDto('c');

  it('saves the contract with its version, removes what left the tray, uploads, then orders', async () => {
    const { api, calls } = fakeApi();
    await saveContractWithFiles(api, {
      mode: 'update',
      id: 'c-1',
      body: { ...BODY, version: 4 },
      before: [a, b, c],
      // b taken out; a new page put first; c before a.
      items: [pending('p1'), saved(c), saved(a)],
    });
    expect(calls).toEqual(['update v4', 'remove b', 'upload p1.png', 'order n1,c,a']);
  });

  it('writes no order when the tray keeps the order the server already holds', async () => {
    const { api, calls } = fakeApi();
    await saveContractWithFiles(api, {
      mode: 'update',
      id: 'c-1',
      body: { ...BODY, version: 2 },
      before: [a, b],
      items: [saved(a), saved(b), pending('p1')],
    });
    expect(calls).toEqual(['update v2', 'upload p1.png']);
  });

  it('a raced order is reported, not thrown — the contract is saved', async () => {
    const { api } = fakeApi();
    api.order = async () => {
      throw new ApiError('STALE_DOCUMENT', 'raced', 409);
    };
    const result = await saveContractWithFiles(api, {
      mode: 'update',
      id: 'c-1',
      body: { ...BODY, version: 2 },
      before: [a, b],
      items: [saved(b), saved(a)],
    });
    expect(result.orderRefused).toBe(true);
  });
});
