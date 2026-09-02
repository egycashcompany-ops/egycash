// A car offered for CHOOSING is named by its code, and by nothing else.
//
// Three controls in the application ask "which car?" — the fleet dropdown in the dialogs, the
// multi-select on the six filtered fleet screens, and the Gold receiving picker. Each of them used
// to answer with the code and a second identifier beside it: `150 — ABC123` in two of them, the
// plate LEADING and the code trailing in grey in the third. Two identifiers where the reader came
// to pick one, and options long enough to wrap the narrow filter rows.
//
// The rule is about SELECTION, not about the plate. A plate still belongs on the rows and detail
// screens that are about a car rather than about choosing one, and it still travels in the payloads
// that need it — Gold's receipt stores it beside the id. So this guard reads the three selectors
// and asserts what they RENDER, which is the part that regressed and the part no unit test of a
// pure function can see.
//
// Deliberately not covered here, and each for a reason:
//
//   • the crew selects on `SecuredDispatchPage` and `ShipmentFormDialog` name a CREW. A vehicle
//     with two captains appears twice, and the captain is what tells the two rows apart — strip it
//     and the operator picks blind between two identical `150`s.
//   • the registry's `search` box is deliberately multi-field (code, plate, chassis, motor); it
//     finds cars rather than naming one.
//   • confirmation dialogs describing a car are not choosing one.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../../../');
const text = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');

/** Every control whose job is to let someone pick a car. */
const SELECTORS = [
  'modules/fleet/components/VehicleSelect.tsx',
  'modules/fleet/lib/vehicle-code-options.ts',
  'modules/gold/components/VehiclePicker.tsx',
] as const;

/**
 * A rendered pair: `{a.code} — {a.plate}`, `{code} / {name}`, `${code} — ${plate}` and friends.
 *
 * Matches the JOIN rather than the field names, so a selector that starts showing the model, the
 * driver or anything else next to the code fails the same way the plate did.
 */
const JOINS_TWO_VALUES =
  /\{[^{}]*\}\s*[-–—/·]\s*\{[^{}]*\}|\$\{[^{}]*\}\s*[-–—/·]\s*\$\{[^{}]*\}/;

describe('a car offered for selection is named by its code alone', () => {
  it.each(SELECTORS.map((path) => ({ path })))('renders no second identifier in $path', ({ path }) => {
    const rendered = text(path)
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    expect(JOINS_TWO_VALUES.test(rendered), `${path} joins two values into one label`).toBe(false);
  });

  it('keeps the plate out of the fleet dropdown while the data still carries it', () => {
    const select = text('modules/fleet/components/VehicleSelect.tsx');
    expect(select).toContain('{vehicle.code}');
    expect(select).not.toContain('vehicle.plateNumber');
  });

  it('names the car by code in the Gold picker, and still hands the plate to the receipt', () => {
    // The display and the payload are different questions. This one has to keep answering both.
    const picker = text('modules/gold/components/VehiclePicker.tsx');
    expect(picker).toContain('{vehicle.code}');
    expect(picker).toContain('onChange(vehicle.id, vehicle.plateNumber)');
  });
});
