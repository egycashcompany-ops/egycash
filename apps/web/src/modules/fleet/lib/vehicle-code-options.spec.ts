// The rule a server-backed code picker lives or dies by: what you have chosen stays reachable.
import { describe, expect, it } from 'vitest';
import { vehicleCodeLabel, vehicleCodeOptions } from './vehicle-code-options';

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
