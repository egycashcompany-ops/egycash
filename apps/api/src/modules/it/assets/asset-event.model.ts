// `it_asset_events` — the asset's business history (design §2.3, ADR-021).
//
// Append-only: rows are never updated and never deleted, and this collection is NOT the audit
// trail. Audit is ops-governed and retention-purged; a custody chain is a business record that has
// to outlive any retention decision, which is exactly why the two are separate (D3).
//
// Built from the module's shared timeline factory — the same one IT-3's ticket stream will use.
import { IT_ASSET_EVENT_TYPES, type ItAssetEventType } from '@ecms/contracts';
import { buildItTimelineModel, type ItTimelineDoc } from '../shared/timeline.model';

export interface ItAssetEventDoc extends ItTimelineDoc {
  type: ItAssetEventType;
}

export const ItAssetEventModel = buildItTimelineModel<ItAssetEventDoc>({
  modelName: 'ItAssetEvent',
  collection: 'it_asset_events',
  types: IT_ASSET_EVENT_TYPES,
});
