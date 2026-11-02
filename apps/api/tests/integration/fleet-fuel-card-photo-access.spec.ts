// The card photo shows the PIN on its sticker (6d): the FULL photo opens only for a holder of
// `fleetFuelCard.reveal` — on the cards' endpoint AND on the platform's own file endpoints — and every
// reader of the cards sees a small blurred thumbnail: the go-live photo's committed one, or the one the
// browser sent beside an upload. A thumbnail is checked from its header; a bad one writes nothing.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ErrorCodes, type FleetFuelCardDto } from '@ecms/contracts';
import { FileModel } from '../../src/platform/files/file.model';
import { FleetFuelCardModel } from '../../src/modules/fleet/fuel-cards/fuel-card.model';
import { REPAIR_RECORDS } from '../../src/modules/fleet/fuel-cards/number-repair/number-repair-definition';
import {
  CARDS,
  REPAIR,
  auth,
  cardOnCar,
  data,
  failure,
  useNumberRepairWorld,
  world,
} from './helpers/fuel-number-repair-world';

useNumberRepairWorld('photo-access');
const { tokens } = world;

const goLive = join(dirname(fileURLToPath(import.meta.url)), '../../assets/fleet-go-live');
const r239 = REPAIR_RECORDS.find((r) => r.car === '239') as (typeof REPAIR_RECORDS)[number];
const photoOf = (number: string): Buffer =>
  readFileSync(join(goLive, 'fuel-card-photos', `${number}.jpg`));
const committedThumbOf = (number: string): Buffer =>
  readFileSync(join(goLive, 'fuel-card-photo-thumbs', `${number}.jpg`));

const image = (id: string, token: string, path = 'image') =>
  request(world.app)
    .get(`${CARDS}/${id}/${path}`)
    .set(...auth(token))
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
const upload = (id: string, photo: Buffer, name: string, thumb?: Buffer, token = tokens.boss) => {
  const req = request(world.app)
    .post(`${CARDS}/${id}/image`)
    .set(...auth(token))
    .attach('file', photo, { filename: name, contentType: 'image/jpeg' });
  return thumb === undefined
    ? req
    : req.attach('thumb', thumb, { filename: 'thumb.jpg', contentType: 'image/jpeg' });
};
const download = (fileId: string, token: string) =>
  request(world.app)
    .get(`/api/v1/platform/files/${fileId}/download`)
    .set(...auth(token));
const live = async (id: string) =>
  (await FleetFuelCardModel.findById(id).lean().exec()) as {
    image: { fileId: unknown; thumb?: { fileId: unknown } | null } | null;
  };

describe('the go-live photo', () => {
  it('a viewer gets the committed thumbnail and never the photo; the reveal grant opens it', async () => {
    const card = await cardOnCar('239');
    const id = String(card._id);
    const dto = data<FleetFuelCardDto>(
      await request(world.app)
        .get(`${CARDS}/${id}`)
        .set(...auth(tokens.viewer)),
    );
    expect(dto.imageThumb).toBe(true);

    const full = await image(id, tokens.viewer);
    expect(full.status).toBe(403);
    const thumb = await image(id, tokens.viewer, 'image/thumb');
    expect([thumb.status, thumb.headers['content-type'], thumb.headers['cache-control']]).toEqual([
      200,
      'image/jpeg',
      'private, no-store',
    ]);
    expect((thumb.body as Buffer).equals(committedThumbOf(r239.before.number))).toBe(true);
  });

  it('a card moved by the repair serves the thumbnail of its NEW number', async () => {
    const res = await request(world.app)
      .post(`${REPAIR}/execute`)
      .set(...auth(tokens.executor))
      .send({ reviewed: true, units: ['C4'] });
    expect(res.status, res.text).toBe(200);
    const card = await cardOnCar('239');
    const thumb = await image(String(card._id), tokens.viewer, 'image/thumb');
    expect(thumb.status).toBe(200);
    expect((thumb.body as Buffer).equals(committedThumbOf(r239.after.number))).toBe(true);
  });
});

describe('an uploaded photo', () => {
  it('is stored with its thumbnail; the photo answers only to the reveal grant, here and on /files', async () => {
    const card = await cardOnCar('241');
    const id = String(card._id);
    await FleetFuelCardModel.updateOne({ _id: card._id }, { $set: { image: null } }).exec();
    const smallThumb = committedThumbOf(r239.before.number);
    const res = await upload(id, photoOf(r239.after.number), 'new.jpg', smallThumb);
    expect(res.status, res.text).toBe(200);
    expect(data<FleetFuelCardDto>(res)).toMatchObject({
      imageThumb: true,
      image: { fileName: 'new.jpg' },
    });
    const doc = await live(id);
    const photoId = String(doc.image?.fileId);
    const thumbId = String(doc.image?.thumb?.fileId);

    expect((await image(id, tokens.viewer)).status).toBe(403);
    const full = await image(id, tokens.revealer);
    expect(full.status).toBe(200);
    expect((full.body as Buffer).equals(photoOf(r239.after.number))).toBe(true);
    const thumb = await image(id, tokens.viewer, 'image/thumb');
    expect([thumb.status, (thumb.body as Buffer).equals(smallThumb)]).toEqual([200, true]);

    // The platform's file endpoints ask the same: the photo needs `reveal` (404 — it is not there
    // for this reader), its thumbnail the cards' view grant.
    expect((await download(photoId, tokens.filesViewer)).status).toBe(404);
    // Allowed: redirected to the signed capability URL.
    expect((await download(photoId, tokens.boss)).status).toBe(302);
    expect((await download(thumbId, tokens.filesViewer)).status).toBe(302);
    expect((await download(thumbId, tokens.stranger)).status).not.toBe(302);
  });

  it('a thumbnail that is not small, or not an image, is refused — nothing written', async () => {
    const card = await cardOnCar('243');
    const id = String(card._id);
    const files = await FileModel.countDocuments({});
    for (const [thumb, code] of [
      [photoOf(r239.after.number), 'BYTES'],
      [Buffer.from('not an image at all'), 'TYPE'],
    ] as const) {
      const res = await upload(id, photoOf(r239.after.number), 'new.jpg', thumb);
      expect([res.status, failure(res).code, failure(res).details?.[0]?.code]).toEqual([
        422,
        ErrorCodes.FLEET_FUEL_CARD_THUMB_INVALID,
        code,
      ]);
    }
    expect(await FileModel.countDocuments({})).toBe(files);
    expect((await cardOnCar('243')).__v).toBe(card.__v);
  });

  it('a new photo drops the old thumbnail; deleting the photo takes its thumbnail too', async () => {
    const card = await cardOnCar('209');
    const id = String(card._id);
    await FleetFuelCardModel.updateOne({ _id: card._id }, { $set: { image: null } }).exec();
    const first = await upload(
      id,
      photoOf(r239.after.number),
      'one.jpg',
      committedThumbOf(r239.after.number),
    );
    expect(first.status, first.text).toBe(200);
    const oldThumb = String((await live(id)).image?.thumb?.fileId);

    const second = await upload(id, photoOf(r239.before.number), 'two.jpg');
    expect(second.status, second.text).toBe(200);
    expect(data<FleetFuelCardDto>(second).imageThumb).toBe(false);
    expect((await live(id)).image?.thumb ?? null).toBeNull();
    expect((await FileModel.findById(oldThumb).lean().exec())?.isDeleted).toBe(true);
    expect((await image(id, tokens.viewer, 'image/thumb')).status).toBe(404);

    const third = await upload(
      id,
      photoOf(r239.before.number),
      'three.jpg',
      committedThumbOf(r239.before.number),
    );
    expect(third.status).toBe(200);
    const thumbId = String((await live(id)).image?.thumb?.fileId);
    const removed = await request(world.app)
      .delete(`${CARDS}/${id}/image`)
      .set(...auth(tokens.boss));
    expect(removed.status).toBe(200);
    expect((await FileModel.findById(thumbId).lean().exec())?.isDeleted).toBe(true);
    expect((await image(id, tokens.viewer, 'image/thumb')).status).toBe(404);
  });

  it('the back-fill of a photo uploaded without one needs edit AND reveal', async () => {
    const card = await cardOnCar('233');
    const id = String(card._id);
    await FleetFuelCardModel.updateOne({ _id: card._id }, { $set: { image: null } }).exec();
    expect((await upload(id, photoOf(r239.after.number), 'old.jpg')).status).toBe(200);
    expect((await image(id, tokens.viewer, 'image/thumb')).status).toBe(404);

    const backfill = (token: string, thumb: Buffer) =>
      request(world.app)
        .post(`${CARDS}/${id}/image/thumb`)
        .set(...auth(token))
        .attach('thumb', thumb, { filename: 'thumb.jpg', contentType: 'image/jpeg' });
    const small = committedThumbOf(r239.after.number);
    expect((await backfill(tokens.editor, small)).status).toBe(403);
    expect((await backfill(tokens.revealer, small)).status).toBe(403);
    const missing = await request(world.app)
      .post(`${CARDS}/${id}/image/thumb`)
      .set(...auth(tokens.boss));
    expect([missing.status, failure(missing).details?.[0]?.code]).toEqual([422, 'REQUIRED']);
    const done = await backfill(tokens.boss, small);
    expect(done.status, done.text).toBe(200);
    expect(data<FleetFuelCardDto>(done).imageThumb).toBe(true);
    const thumb = await image(id, tokens.viewer, 'image/thumb');
    expect([thumb.status, (thumb.body as Buffer).equals(small)]).toEqual([200, true]);
  });
});
