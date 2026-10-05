// An asset's specifications and accessories, as the screens edit and show them (FR-18).
//
// They are what the custody acknowledgment («إقرار استلام») prints for the device: the rows of its
// specifications table and the numbered list under «ومشتملاته كالتالي:». The form edits them, the
// asset page shows them, and the hand-over prefills its accessories from them — one list of
// fields for all three, in the order the paper prints them.
import { type ItAssetSpecKey, type ItAssetSpecs, type ItAssetSpecsDto } from '@ecms/contracts';

/** The single-value rows, in the paper's order, with the label each shows on screen. */
export const SPEC_FIELDS: readonly { key: ItAssetSpecKey; label: string }[] = [
  { key: 'processor', label: 'it.assets.specs.processor' },
  { key: 'memory', label: 'it.assets.specs.memory' },
  { key: 'systemType', label: 'it.assets.specs.systemType' },
  { key: 'storage', label: 'it.assets.specs.storage' },
  { key: 'mediaDrive', label: 'it.assets.specs.mediaDrive' },
  { key: 'displayAdapter', label: 'it.assets.specs.displayAdapter' },
  { key: 'graphicsMemory', label: 'it.assets.specs.graphicsMemory' },
];

/** One per line — the honest editor for a list. */
export const toLines = (values: readonly string[]): string => values.join('\n');
export const fromLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** The table as the form holds it: a box per row, the network adapters one per line. */
export type SpecsDraft = Record<ItAssetSpecKey, string> & { networkAdapters: string };

export const specsDraft = (specs: ItAssetSpecsDto | null): SpecsDraft => ({
  processor: specs?.processor ?? '',
  memory: specs?.memory ?? '',
  systemType: specs?.systemType ?? '',
  storage: specs?.storage ?? '',
  mediaDrive: specs?.mediaDrive ?? '',
  displayAdapter: specs?.displayAdapter ?? '',
  graphicsMemory: specs?.graphicsMemory ?? '',
  networkAdapters: toLines(specs?.networkAdapters ?? []),
});

/** What the API is sent: only the rows that were typed — undefined when none was. */
export const specsInput = (draft: SpecsDraft): ItAssetSpecs | undefined => {
  const input: ItAssetSpecs = {};
  for (const { key } of SPEC_FIELDS) {
    const value = draft[key].trim();
    if (value !== '') input[key] = value;
  }
  const adapters = fromLines(draft.networkAdapters);
  if (adapters.length > 0) input.networkAdapters = adapters;
  return Object.keys(input).length === 0 ? undefined : input;
};

/** Whether the asset has anything for the paper's table or list. */
export const hasSpecsOrAccessories = (
  specs: ItAssetSpecsDto | null,
  accessories: readonly string[],
): boolean =>
  accessories.length > 0 ||
  (specs !== null &&
    (specs.networkAdapters.length > 0 || SPEC_FIELDS.some(({ key }) => specs[key] !== null)));
