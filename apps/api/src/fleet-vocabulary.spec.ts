// The vocabulary itself, read as data — no platform, no database.
//
// What is worth pinning here is not that a list has entries, but the three things about it that
// would be wrong silently: a name that carries whitespace the catalog's duplicate guard cannot
// see past, a duplicate inside one list, and — the expensive one — the wrong set of work types
// counting for the maintenance alarm.
import { describe, expect, it } from 'vitest';
import { COUNTING_WORK_TYPES, FLEET_VOCABULARY } from './fleet-vocabulary';

const list = (kind: string): readonly string[] =>
  FLEET_VOCABULARY.find((entry) => entry.kind === kind)?.names ?? [];

describe('the Fleet vocabulary the owner handed over', () => {
  it('covers the five catalogs it was given for, and nothing else', () => {
    expect(FLEET_VOCABULARY.map((entry) => entry.kind)).toEqual([
      'workshop',
      'workType',
      'sparePart',
      'missionType',
      'insuranceCompany',
    ]);
  });

  it('carries the counts the owner sent', () => {
    // Straight off the message: 12 destinations, 9 works, 132 parts, 12 mission types, 2 insurers.
    // A list that quietly loses an entry in an edit is a part nobody can pick any more.
    expect(list('workshop')).toHaveLength(12);
    expect(list('workType')).toHaveLength(9);
    expect(list('sparePart')).toHaveLength(132);
    expect(list('missionType')).toHaveLength(12);
    expect(list('insuranceCompany')).toHaveLength(2);
  });

  it('holds no name that is padded, empty, or doubly spaced', () => {
    // The catalog's duplicate guard matches `name.ar` EXACTLY. «طلمبة جاز » and «طلمبة جاز» are
    // therefore two parts to it — two rows that look identical in the dropdown, and two halves of
    // every report that counts them. Several names arrived padded; this is what keeps them trimmed.
    for (const { kind, names } of FLEET_VOCABULARY) {
      for (const name of names) {
        expect(name, `${kind}: «${name}» is padded`).toBe(name.trim());
        expect(name.length, `${kind}: empty name`).toBeGreaterThan(0);
        expect(name, `${kind}: «${name}» has a double space`).not.toContain('  ');
      }
    }
  });

  it('repeats no name inside one catalog', () => {
    for (const { kind, names } of FLEET_VOCABULARY) {
      const seen = new Set(names);
      expect(seen.size, `${kind} has a repeat`).toBe(names.length);
    }
  });

  it('counts «صيانة» and «صيانة + إصلاح» for the alarm, and NOTHING else', () => {
    // The most consequential line in the file. A visit whose work type is not counted leaves the
    // alarm measuring from the service before it and says nothing while it does — which is exactly
    // what happened on vehicle 150 with «تقطيع»: hours spent looking for a broken calculation that
    // was working correctly on a flag nobody had ticked.
    expect([...COUNTING_WORK_TYPES].sort()).toEqual(['صيانة', 'صيانة + إصلاح'].sort());
    // Every counted name is a real work type, or the flag would never reach a row.
    for (const name of COUNTING_WORK_TYPES) {
      expect(list('workType'), `${name} is a work type`).toContain(name);
    }
    // And the ones that must NOT count, named so a careless edit has to argue with this line.
    for (const name of ['إصلاح', 'سمكرة', 'تغيير زجاج', 'بطاريه', 'ضبط الفرامل']) {
      expect(COUNTING_WORK_TYPES, `${name} must not reset the counter`).not.toContain(name);
    }
  });

  it('puts each list in the catalog the owner named for it', () => {
    // The mapping was confirmed by the owner off the legacy collection names, and getting it wrong
    // is invisible: the items appear, in the wrong dropdown, on a screen nobody is looking at.
    expect(list('workshop'), 'fleet_destinations → الورش').toContain('مصنع قادر');
    expect(list('workType'), 'fleet_works → أنواع الأعمال').toContain('سمكرة');
    expect(list('sparePart'), 'fleet_spare_parts → قطع الغيار').toContain('فلتر زيت');
    expect(list('missionType'), 'fleet_ops_tybe → أنواع المهمات').toContain('نقل أموال (يومي)');
    expect(list('insuranceCompany'), 'fleet_insurance → شركات التأمين').toContain('مصر للتأمين');
    // …and the two that are easiest to confuse are each on ONE list only.
    expect(list('workshop'), 'a mission type is not a workshop').not.toContain('سفر');
    expect(list('missionType'), 'a workshop is not a mission type').not.toContain('تويوتا');
  });
});
