// «تصحيح القراءة» is not offered on a row the old book kept for a car the registry does not have.
//
// Such a row is on no car's chain: its neighbours would be looked up by `vehicleId: null`, which
// is every such row of every unknown car at once, so the server refuses to correct it (C3). A
// button that can only end in a refusal is not offered; deleting the row stays offered, as the
// server still allows it.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(HERE, 'pages/OdometerPage.tsx'), 'utf8');

describe('the odometer row actions', () => {
  it('offer the correction only on a row with a registry car', () => {
    expect(page).toContain("can('fleetOdometer.correct') && log.vehicleId !== null && (");
  });

  it('and still offer the delete on every row', () => {
    expect(page).toContain("can('fleetOdometer.delete') && (");
  });
});
