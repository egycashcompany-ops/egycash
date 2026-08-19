// The transition map IS the ported legacy behaviour — each assertion cites the legacy write it
// preserves, so a refactor that "simplifies" the map fails against the citation, not a vibe.
import { describe, expect, it } from 'vitest';
import { canTransitionShipment, reopenTarget } from './shipment-status';

describe('shipment status transitions (legacy parity)', () => {
  it('daily completes from draft (contad_app.js:564) and from nowhere else', () => {
    expect(canTransitionShipment('daily', 'draft', 'completed')).toBe(true);
    expect(canTransitionShipment('daily', 'inVault', 'completed')).toBe(false);
    expect(canTransitionShipment('daily', 'dispatched', 'completed')).toBe(false);
  });

  it('daily un-receive returns to draft — status 0 (contad_app.js:555)', () => {
    expect(canTransitionShipment('daily', 'completed', 'draft')).toBe(true);
    expect(reopenTarget('daily')).toBe('draft');
  });

  it('daily never enters the vault lifecycle', () => {
    expect(canTransitionShipment('daily', 'draft', 'inVault')).toBe(false);
    expect(canTransitionShipment('daily', 'draft', 'dispatched')).toBe(false);
  });

  it('secured walks draft → inVault → dispatched → completed (:1220, :1737, :564)', () => {
    expect(canTransitionShipment('secured', 'draft', 'inVault')).toBe(true);
    expect(canTransitionShipment('secured', 'inVault', 'dispatched')).toBe(true);
    expect(canTransitionShipment('secured', 'dispatched', 'completed')).toBe(true);
  });

  it('secured un-receive returns to dispatched — status 3, not 0 (contad_app.js:559)', () => {
    expect(canTransitionShipment('secured', 'completed', 'dispatched')).toBe(true);
    expect(canTransitionShipment('secured', 'completed', 'draft')).toBe(false);
    expect(reopenTarget('secured')).toBe('dispatched');
  });

  it('Q30 normalization: secured cannot jump straight to completed from draft or inVault', () => {
    expect(canTransitionShipment('secured', 'draft', 'completed')).toBe(false);
    expect(canTransitionShipment('secured', 'inVault', 'completed')).toBe(false);
  });

  it('refuses skipping the vault: secured draft → dispatched is not a step', () => {
    expect(canTransitionShipment('secured', 'draft', 'dispatched')).toBe(false);
  });
});
