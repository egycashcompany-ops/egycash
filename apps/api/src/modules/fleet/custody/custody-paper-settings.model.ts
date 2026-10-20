// «إعداد المذكرات» — the names each of his seven papers prints with: the four memos (كاوتش، وقود،
// صيانة، غسيل) and the three letters (استعاضة، تسوية، شحن). One row for the whole screen; absent
// until somebody saves, and his own names are read until then
// (`DEFAULT_FLEET_CUSTODY_PAPER_SIGNATURES`).
//
// The papers are kept as one plain map, the way the licence set-up keeps its templates: each paper
// is validated by the contract on the way in, and re-validated paper by paper on the way out, so a
// paper stored under an older shape falls back to his defaults instead of printing half a block.
import { Schema, model } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

export interface FleetCustodyPaperSettingsDoc extends BaseDocFields {
  /** Always `'default'` — the one set-up's key. */
  key: string;
  /** paper → `FleetCustodyPaperSignatures`, as saved. Read through `mergePaperSettings`. */
  papers: Record<string, unknown>;
}

const custodyPaperSettingsSchema = new Schema<FleetCustodyPaperSettingsDoc>(
  {
    key: { type: String, required: true, default: 'default' },
    papers: { type: Schema.Types.Mixed, default: {} },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

custodyPaperSettingsSchema.index(
  { key: 1 },
  {
    name: 'ux_custody_paper_settings_key',
    unique: true,
    partialFilterExpression: { isDeleted: false },
  },
);

export const FleetCustodyPaperSettingsModel = model<FleetCustodyPaperSettingsDoc>(
  'FleetCustodyPaperSettings',
  custodyPaperSettingsSchema,
  'fleet_custody_paper_settings',
);
