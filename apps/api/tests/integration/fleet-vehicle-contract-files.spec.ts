// «مرفقات العقد» and the grants of «عقود توريد السيارات», over HTTP: an Arabic file name survives
// the upload, the bytes come back, the order is guarded by the live set, a removal is soft on both
// sides, the platform's own /files endpoints answer by the contract's grants, and every write is
// gated by its own grant.
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Express } from 'express';
import mongoose, { Types } from 'mongoose';
import {
  CreateFleetVehicleContractSchema,
  type FleetVehicleContractDto,
  type FleetVehicleContractFileDto,
} from '@ecms/contracts';
import { FileModel } from '../../src/platform/files/file.model';
import { FleetVehicleContractModel } from '../../src/modules/fleet/vehicle-contracts/vehicle-contract.model';
import {
  PNG,
  URL_,
  auth,
  bootVehicleContracts,
  create,
  created,
  data,
  receive,
  stopVehicleContracts,
} from './helpers/vehicle-contract-fixture';

let app: Express;
let admin = '';
let viewer = '';
let creator = '';
let fileReader = '';
let typeA = '';

beforeAll(async () => {
  ({ app, admin, viewer, creator, fileReader, typeA } = await bootVehicleContracts());
}, 240_000);

afterAll(stopVehicleContracts);

describe('«مرفقات العقد» over HTTP', () => {
  let contract: FleetVehicleContractDto;
  const upload = (token: string, body: Buffer, filename: string, contentType: string) =>
    request(app)
      .post(`${URL_}/${contract.id}/files`)
      .set(auth(token))
      .attach('file', body, { filename, contentType });

  beforeAll(async () => {
    contract = await created({ date: '2026-10-10', lines: [{ typeId: typeA, count: 1 }] });
  });

  it('keeps an Arabic name, serves the bytes, orders, and removes softly', async () => {
    const png = await upload(creator, PNG, 'صفحة 1.png', 'image/png');
    expect(png.status, JSON.stringify(png.body)).toBe(201);
    const first = data<FleetVehicleContractFileDto>(png);
    expect(first).toMatchObject({ fileName: 'صفحة 1.png', kind: 'image', mime: 'image/png' });
    const pdf = data<FleetVehicleContractFileDto>(
      await upload(admin, Buffer.from('%PDF-1.4\n%%EOF'), 'عقد.pdf', 'application/pdf'),
    );
    expect(pdf.kind).toBe('pdf');
    expect((await upload(admin, Buffer.from('hello'), 'a.txt', 'text/plain')).status).toBe(422);

    const bytes = await request(app)
      .get(`${URL_}/${contract.id}/files/${first.fileId}`)
      .set(auth(viewer));
    expect(bytes.status).toBe(200);
    expect(bytes.headers['content-type']).toContain('image/png');
    expect(bytes.headers['content-disposition']).toContain(encodeURIComponent('صفحة 1.png'));

    const order = (fileIds: string[]) =>
      request(app).put(`${URL_}/${contract.id}/files/order`).set(auth(admin)).send({ fileIds });
    expect((await order([first.fileId])).status).toBe(422);
    const reordered = await order([pdf.fileId, first.fileId]);
    expect(data<FleetVehicleContractDto>(reordered).files.map((f) => f.fileId)).toEqual([
      pdf.fileId,
      first.fileId,
    ]);

    expect(
      (await request(app).delete(`${URL_}/${contract.id}/files/${first.fileId}`).set(auth(admin)))
        .status,
    ).toBe(204);
    const read = data<FleetVehicleContractDto>(
      await request(app).get(`${URL_}/${contract.id}`).set(auth(viewer)),
    );
    expect(read.files.map((f) => f.fileId)).toEqual([pdf.fileId]);
    const raw = await FleetVehicleContractModel.findById(contract.id).lean();
    expect(raw?.files.find((f) => String(f.fileId) === first.fileId)?.isDeleted).toBe(true);
    expect((await FileModel.findById(first.fileId).lean())?.isDeleted).toBe(true);
    expect(read.version).toBe(contract.version); // attachments never bump the version
  });

  it('answers the platform /files endpoints by the contract grants — a stranger is told nothing', async () => {
    const file = data<FleetVehicleContractFileDto>(await upload(admin, PNG, 'p.png', 'image/png'));
    expect(
      (await request(app).get(`/api/v1/platform/files/${file.fileId}`).set(auth(fileReader)))
        .status,
    ).toBe(404);
    expect(
      (await request(app).get(`/api/v1/platform/files/${file.fileId}`).set(auth(admin))).status,
    ).toBe(200);
  });
});

describe('the grants', () => {
  it('gates create, edit, delete, receive and the attachments; view alone reads the makes', async () => {
    const dto = await created({ date: '2026-10-11', lines: [{ typeId: typeA, count: 1 }] });
    const body = { date: '2026-10-11', version: 0, lines: [{ typeId: typeA, count: 1 }] };
    const fid = new Types.ObjectId().toString();
    expect((await create({ date: '2026-10-11', lines: body.lines }, viewer)).status).toBe(403);
    expect(
      (await request(app).patch(`${URL_}/${dto.id}`).set(auth(creator)).send(body)).status,
    ).toBe(403);
    expect((await request(app).delete(`${URL_}/${dto.id}`).set(auth(creator))).status).toBe(403);
    expect(
      (
        await receive(
          dto.id,
          { date: '2026-10-11', version: 0, counts: [{ lineId: dto.lines[0]?.id, count: 1 }] },
          creator,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(`${URL_}/${dto.id}/files`)
          .set(auth(viewer))
          .attach('file', PNG, 'x.png')
      ).status,
    ).toBe(403);
    expect(
      (await request(app).delete(`${URL_}/${dto.id}/files/${fid}`).set(auth(viewer))).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put(`${URL_}/${dto.id}/files/order`)
          .set(auth(viewer))
          .send({ fileIds: [fid] })
      ).status,
    ).toBe(403);
    expect((await request(app).get('/api/v1/fleet/vehicle-types').set(auth(viewer))).status).toBe(
      200,
    );
    expect(
      CreateFleetVehicleContractSchema.safeParse({ date: '2026-10-11', lines: [] }).success,
    ).toBe(false);
    expect(mongoose.connection.readyState).toBe(1);
  });
});
