// «المأمورية» on the fuel memo — the suggestion's order: the day's roster row, then the car's fixed
// crew, then the car's own «التشغيل»; the first that names something wins.
import { describe, expect, it } from 'vitest';
import { pickMission, type MissionSources } from './custody-mission';

const CAR = 'car-204';
const DAY = '2026-09-20';

const sources = (over: Partial<MissionSources> = {}): MissionSources => ({
  duty: new Map([[`${CAR}|${DAY}`, 'm-duty']]),
  fixed: new Map([[CAR, 'm-fixed']]),
  operation: new Map([[CAR, 'op-car']]),
  names: new Map([
    ['m-duty', 'نقل اموال'],
    ['m-fixed', 'ATM'],
    ['op-car', 'ملاكى'],
  ]),
  ...over,
});

describe('the suggested «المأمورية»', () => {
  it('the day’s roster row comes first', () => {
    expect(pickMission(CAR, DAY, sources())).toBe('نقل اموال');
  });

  it('then the car’s fixed crew — on a day the roster has no row, or a row with no mission', () => {
    expect(pickMission(CAR, '2026-09-21', sources())).toBe('ATM');
    expect(pickMission(CAR, DAY, sources({ duty: new Map([[`${CAR}|${DAY}`, null]]) }))).toBe(
      'ATM',
    );
  });

  it('then the car’s own «التشغيل»', () => {
    expect(pickMission(CAR, DAY, sources({ duty: new Map(), fixed: new Map() }))).toBe('ملاكى');
  });

  it('nothing at all is no suggestion — never a guess', () => {
    expect(
      pickMission(CAR, DAY, sources({ duty: new Map(), fixed: new Map(), operation: new Map() })),
    ).toBeNull();
    expect(pickMission('another-car', DAY, sources())).toBeNull();
  });

  it('a source whose catalog item has no name (or a blank one) is passed over', () => {
    expect(pickMission(CAR, DAY, sources({ names: new Map([['op-car', 'ملاكى']]) }))).toBe('ملاكى');
    expect(
      pickMission(
        CAR,
        DAY,
        sources({
          names: new Map([
            ['m-duty', '   '],
            ['m-fixed', 'ATM'],
          ]),
        }),
      ),
    ).toBe('ATM');
  });
});
