// Atomic asset-code allocation. The counter itself lives in the module's shared allocator
// (`shared/sequence.ts`) — `it_sequences` is one collection for every IT code (design §2.1), and
// two copies of that model would drift the moment one changed.
import { ASSET_SEQUENCE_KEY, formatAssetCode } from './asset-number';
import { nextSequenceValue } from '../shared/sequence';

export const nextAssetCode = async (): Promise<string> =>
  formatAssetCode(await nextSequenceValue(ASSET_SEQUENCE_KEY));
