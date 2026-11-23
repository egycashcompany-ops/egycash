// The seals the vault receive form sends.
//
// Until Round 18 the seals were one free-text box per list, split on newlines and commas. The legacy
// form the owner asked back («عاوز اخلى الفورم دا لما اجى استلم محصنة») draws ONE BOX PER SEAL —
// bags × «2×»/«3×», two per box — and a scanner fills them one by one. What stays true: seals arrive
// from a scanner or a hand, so a stray space or a box left empty is normal input, not an error, and
// an empty string must never reach the server as a seal that does not exist.
import { describe, expect, it } from 'vitest';
import { ReceiveIntoVaultSchema } from '@ecms/contracts';
import { draftSlots, growSeals, receiveRequest, sealsToSend } from '../lib/vault-receipt';

describe('the seals sent from the boxes', () => {
  it('sends one seal per filled box, in box order — what the scanner typed', () => {
    expect(sealsToSend(['S1', 'S2', 'S3', 'S4'], 4)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('drops an empty box, so no empty seal is invented', () => {
    expect(sealsToSend(['S1', '', '  ', 'S2'], 4)).toEqual(['S1', 'S2']);
  });

  it('is an empty list when no box is filled, never a list holding one empty string', () => {
    expect(sealsToSend([], 4)).toEqual([]);
    expect(sealsToSend(['', '   '], 2)).toEqual([]);
  });

  it('trims each seal', () => {
    expect(sealsToSend(['  S1  ', ' S2'], 2)).toEqual(['S1', 'S2']);
  });

  it('sends the boxes on screen only — a seal hidden by a lowered count is not this receipt’s', () => {
    // 2 bags at «3×» typed six seals; the radio back at «2×» shows four boxes.
    const typed = growSeals(['1', '3', '4', '6', '7', '8'], 6);
    const { bags } = draftSlots({ bagCount: '2', boxCount: '0', bagSealsPerBag: 2 });
    expect(sealsToSend(typed, bags)).toEqual(['1', '3', '4', '6']);
  });

  it('reaches the contract as the server stores it — trimmed, blanks dropped, nothing refused', () => {
    const body = receiveRequest(
      {
        receiptNumber: '',
        bagCount: '1',
        boxCount: '1',
        cartonCount: '',
        bagSealsPerBag: 2,
        bagSeals: [' 11 ', ''],
        boxSeals: ['', ' 21'],
        denominations: [],
        serialTracked: false,
      },
      undefined,
      0,
    );
    expect(body.bagSeals).toEqual(['11']);
    expect(body.boxSeals).toEqual(['21']);
    const parsed = ReceiveIntoVaultSchema.parse(body);
    expect(parsed.bagSeals).toEqual(body.bagSeals);
    expect(parsed.boxSeals).toEqual(body.boxSeals);
  });
});
