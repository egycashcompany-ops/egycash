// The rule a server-backed code picker lives or dies by: what you have chosen stays reachable.
import { describe, expect, it } from 'vitest';
import {
  narrowVehicleCodeOptions,
  registryVehicleCodeOptions,
  vehicleCodeLabel,
  vehicleCodeOptions,
} from './vehicle-code-options';

const v = (code: string) => ({ code, plateNumber: `س ص ${code}` });

describe('vehicleCodeOptions', () => {
  it('offers what the search matched', () => {
    expect(vehicleCodeOptions([v('150'), v('151')], [])).toEqual([
      { value: '150', label: '150', shortLabel: '150' },
      { value: '151', label: '151', shortLabel: '151' },
    ]);
  });

  it('offers a car the search matched however far down the registry it sits', () => {
    // Nothing here knows or cares where 4021 falls in the registry — only that it was matched.
    expect(vehicleCodeOptions([v('4021')], []).map((o) => o.value)).toEqual(['4021']);
  });

  it('KEEPS a chosen code the search no longer returns, or it cannot be un-chosen', () => {
    const options = vehicleCodeOptions([v('150')], ['4021']);
    expect(
      options.map((o) => o.value),
      'the selection leads',
    ).toEqual(['4021', '150']);
    // Bare: the registry sent no plate for it this time, and inventing one would be worse.
    // The trigger shows the code either way, so the short form is the code itself.
    expect(options[0]).toEqual({ value: '4021', label: '4021', shortLabel: '4021' });
  });

  it('does not duplicate a chosen code the search DID return', () => {
    expect(vehicleCodeOptions([v('150'), v('151')], ['150']).map((o) => o.value)).toEqual([
      '150',
      '151',
    ]);
  });

  it('never offers the same code twice, however often the URL repeats it', () => {
    expect(vehicleCodeOptions([], ['150', '150']).map((o) => o.value)).toEqual(['150']);
  });

  it('is empty when nothing is matched and nothing is chosen', () => {
    expect(vehicleCodeOptions([], [])).toEqual([]);
  });

  it('labels a car by its CODE, and by nothing else', () => {
    // This asserted `150 — س ص 150` until the plate was taken out of every selector in the app: a
    // car offered for choosing is offered by the code, which is what an operator names it by.
    expect(vehicleCodeLabel(v('150'))).toBe('150');
  });

  it('never lets a plate reach a label, whatever the registry sent with the car', () => {
    // The summary still CARRIES the plate — callers pass whole vehicles and the search matches on
    // it — so the guarantee has to be about the label, not about the absence of the data.
    const [option] = vehicleCodeOptions([{ code: '150', plateNumber: 'ABC123' }], []);
    expect(option?.label).toBe('150');
    expect(option?.label).not.toContain('ABC123');
  });

  it('says the same thing on the trigger as in the list', () => {
    const [option] = vehicleCodeOptions([v('150')], []);
    expect(option?.shortLabel).toBe('150');
    expect(option?.shortLabel).toBe(option?.label);
  });
});

// ── The board's own list, narrowed here because nothing else narrows it ─────────────────────────
//
// The alarms board hands the picker every car it reports on instead of searching the registry, so
// there is no request for the typing to change. `MultiSelect` reads the presence of an `onSearch`
// handler as "somebody else is filtering" — and this control passes one on every screen, because
// that is how a typed code is TAKEN into the selection. Nobody was filtering: typing narrowed
// nothing at all, on a board that lists the whole fleet.
describe('narrowVehicleCodeOptions', () => {
  const opts = (...codes: string[]) =>
    codes.map((code) => ({ value: code, label: code, shortLabel: code }));

  it('narrows the passed-in list to what is being typed', () => {
    expect(
      narrowVehicleCodeOptions(opts('150', '151', '213'), '15', []).map((o) => o.value),
    ).toEqual(['150', '151']);
  });

  it('an empty box asks nothing and keeps every car', () => {
    for (const typed of ['', '   ', '-', ' - ']) {
      expect(narrowVehicleCodeOptions(opts('150', '213'), typed, []).map((o) => o.value)).toEqual([
        '150',
        '213',
      ]);
    }
  });

  it('matches the code the same way the roster boards do — several codes are OR-ed', () => {
    expect(
      narrowVehicleCodeOptions(opts('150', '151', '213'), '150 - 213', []).map((o) => o.value),
    ).toEqual(['150', '213']);
  });

  it('KEEPS a chosen code whatever is typed, or it cannot be un-chosen', () => {
    // The same promise `vehicleCodeOptions` keeps for the searched list. A filter you can set must
    // stay one you can unset, and the panel is the only place to un-tick it.
    expect(
      narrowVehicleCodeOptions(opts('150', '213'), '213', ['150']).map((o) => o.value),
    ).toEqual(['150', '213']);
  });

  it('offers nothing when nothing matches and nothing is chosen', () => {
    expect(narrowVehicleCodeOptions(opts('150', '213'), '999', [])).toEqual([]);
  });
});

describe('registryVehicleCodeOptions — every car, narrowed by the typed code', () => {
  const values = (options: { value: string }[]): string[] => options.map((o) => o.value);
  // 213 cars, in no particular order — the filter must offer all of them, not the first fifty.
  const fleet = Array.from({ length: 213 }, (_, at) => v(String(150 + ((at * 37) % 213))));

  it('offers EVERY car when nothing is typed, in the fleet’s own order', () => {
    const shown = values(registryVehicleCodeOptions(fleet, '', []));
    expect(shown).toHaveLength(213);
    expect(shown.slice(0, 3)).toEqual(['150', '151', '152']);
    expect(shown.at(-1)).toBe('362');
  });

  it('puts the codes that START with what was typed first', () => {
    const shown = values(
      registryVehicleCodeOptions([v('121'), v('210'), v('215'), v('321')], '21', []),
    );
    // …then the codes that only contain it, in the fleet's order: 150 upward before the ones below.
    expect(shown).toEqual(['210', '215', '321', '121']);
  });

  it('keeps a chosen code that the typing hides, in front', () => {
    const shown = values(registryVehicleCodeOptions([v('150'), v('215'), v('216')], '21', ['150']));
    expect(shown).toEqual(['150', '215', '216']);
  });

  it('keeps a chosen code the registry no longer carries, once', () => {
    const shown = values(registryVehicleCodeOptions([v('150')], '', ['999', '999']));
    expect(shown).toEqual(['999', '150']);
  });
});
