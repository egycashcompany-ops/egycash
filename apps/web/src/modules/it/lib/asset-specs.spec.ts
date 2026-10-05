// What the asset form sends for the acknowledgment's table and accessories: only what was typed,
// the network adapters and accessories one per line, and an emptied form erases them.
import { describe, expect, it } from 'vitest';
import { type ItAssetSpecsDto } from '@ecms/contracts';
import {
  SPEC_FIELDS,
  fromLines,
  hasSpecsOrAccessories,
  specsDraft,
  specsInput,
  toLines,
} from './asset-specs';

const SPECS: ItAssetSpecsDto = {
  processor: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache',
  memory: '4.00 GB RAM',
  systemType: null,
  storage: '500 GB',
  mediaDrive: null,
  displayAdapter: null,
  graphicsMemory: null,
  networkAdapters: ['Dell Wireless 1701 802.11 b/g/n', 'Realtec PCIe FE Family Controller'],
};

describe('the specifications as the form edits them', () => {
  it('lists the paper’s single-value rows in its order', () => {
    expect(SPEC_FIELDS.map(({ key }) => key)).toEqual([
      'processor',
      'memory',
      'systemType',
      'storage',
      'mediaDrive',
      'displayAdapter',
      'graphicsMemory',
    ]);
  });

  it('round-trips an asset’s table through the form', () => {
    const draft = specsDraft(SPECS);
    expect(draft.systemType).toBe('');
    expect(draft.networkAdapters).toBe(
      'Dell Wireless 1701 802.11 b/g/n\nRealtec PCIe FE Family Controller',
    );
    expect(specsInput(draft)).toEqual({
      processor: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache',
      memory: '4.00 GB RAM',
      storage: '500 GB',
      networkAdapters: ['Dell Wireless 1701 802.11 b/g/n', 'Realtec PCIe FE Family Controller'],
    });
  });

  it('sends nothing for an empty table — on edit that clears it', () => {
    expect(specsInput(specsDraft(null))).toBeUndefined();
    expect(specsInput({ ...specsDraft(null), processor: '   ', networkAdapters: '\n \n' })).toBe(
      undefined,
    );
  });

  it('reads a list one entry per line, ignoring blank lines and stray spaces', () => {
    expect(fromLines(' شاحن لاب توب \n\n حقيبة\n')).toEqual(['شاحن لاب توب', 'حقيبة']);
    expect(toLines(['شاحن لاب توب', 'حقيبة'])).toBe('شاحن لاب توب\nحقيبة');
    expect(fromLines('')).toEqual([]);
  });

  it('knows when there is nothing to show', () => {
    expect(hasSpecsOrAccessories(null, [])).toBe(false);
    expect(hasSpecsOrAccessories(specsDraftless(), [])).toBe(false);
    expect(hasSpecsOrAccessories(null, ['شاحن'])).toBe(true);
    expect(hasSpecsOrAccessories(SPECS, [])).toBe(true);
    expect(hasSpecsOrAccessories({ ...specsDraftless(), networkAdapters: ['Wi-Fi'] }, [])).toBe(
      true,
    );
  });
});

/** A table with every row empty. */
function specsDraftless(): ItAssetSpecsDto {
  return {
    processor: null,
    memory: null,
    systemType: null,
    storage: null,
    mediaDrive: null,
    displayAdapter: null,
    graphicsMemory: null,
    networkAdapters: [],
  };
}
