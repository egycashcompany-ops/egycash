// «عقود توريد السيارات» — one supply contract: the makes and how many cars of each the supplier
// owes («بنود العقد»), by when («آخر موعد للتوريد»), the cars that arrived («الاستلامات») and the
// contract's scanned pages («مرفقات العقد»).
//
// NOTHING DERIVED IS STORED. Received, remaining, the money total and the supply alarm are computed
// whenever the contract is read (vehicle-contract.figures.ts), and the list orders and filters by
// the same figures spelled as aggregation expressions (vehicle-contract.repository.ts).
//
// SOFT DELETE ALL THE WAY DOWN. A contract, a delivery and an attachment link each carry their own
// `isDeleted`: a removed delivery stays in the document (hidden, its cars back in «المتبقي»), and an
// attachment's bytes stay in the Files service (`fileService.softDelete`).
import { Schema, model, type Types } from 'mongoose';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../shared/base/base.model';

/** One line: a make («الماركة», a `fleet_vehicle_types` id), its count and optional unit price. */
export interface FleetVehicleContractLineDoc {
  _id: Types.ObjectId;
  typeId: Types.ObjectId;
  count: number;
  /** EGP, excluding VAT; `null` when not given (it counts as 0 in the totals). */
  unitPrice: number | null;
}

export interface FleetVehicleContractDeliveryCountDoc {
  lineId: Types.ObjectId;
  count: number;
}

/** One «استلام»: the day, and the cars it brought on each line (counts above 0 only). */
export interface FleetVehicleContractDeliveryDoc {
  _id: Types.ObjectId;
  /** UTC midnight of the delivery's day. */
  date: Date;
  counts: FleetVehicleContractDeliveryCountDoc[];
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  createdBy: Types.ObjectId | null;
  updatedAt: Date;
  updatedBy: Types.ObjectId | null;
}

/** The contract's link to one platform file. The array's order is the display order. */
export interface FleetVehicleContractFileLinkDoc {
  fileId: Types.ObjectId;
  fileName: string;
  mime: string;
  size: number;
  addedAt: Date;
  addedBy: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
}

export interface FleetVehicleContractDoc extends BaseDocFields {
  /** The system's sequence («عقد رقم N») — never reused, deleted contracts included. */
  no: number;
  name: string;
  /** UTC midnight of the contract's day. */
  date: Date;
  /** «آخر موعد للتوريد», UTC midnight; `null` when none. */
  deadline: Date | null;
  supplier: string;
  lines: FleetVehicleContractLineDoc[];
  deliveries: FleetVehicleContractDeliveryDoc[];
  files: FleetVehicleContractFileLinkDoc[];
}

const lineSchema = new Schema<FleetVehicleContractLineDoc>({
  typeId: { type: Schema.Types.ObjectId, required: true },
  count: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, default: null, min: 0 },
});

const deliveryCountSchema = new Schema<FleetVehicleContractDeliveryCountDoc>(
  {
    lineId: { type: Schema.Types.ObjectId, required: true },
    count: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const deliverySchema = new Schema<FleetVehicleContractDeliveryDoc>({
  date: { type: Date, required: true },
  counts: { type: [deliveryCountSchema], default: [] },
  isDeleted: { type: Boolean, required: true, default: false },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, default: null },
  createdAt: { type: Date, required: true },
  createdBy: { type: Schema.Types.ObjectId, default: null },
  updatedAt: { type: Date, required: true },
  updatedBy: { type: Schema.Types.ObjectId, default: null },
});

const fileLinkSchema = new Schema<FleetVehicleContractFileLinkDoc>(
  {
    fileId: { type: Schema.Types.ObjectId, required: true },
    fileName: { type: String, default: '' },
    mime: { type: String, default: '' },
    size: { type: Number, default: 0 },
    addedAt: { type: Date, required: true },
    addedBy: { type: Schema.Types.ObjectId, default: null },
    isDeleted: { type: Boolean, required: true, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const vehicleContractSchema = new Schema<FleetVehicleContractDoc>(
  {
    no: { type: Number, required: true },
    name: { type: String, default: '' },
    date: { type: Date, required: true },
    deadline: { type: Date, default: null },
    supplier: { type: String, default: '' },
    lines: { type: [lineSchema], default: [] },
    deliveries: { type: [deliverySchema], default: [] },
    files: { type: [fileLinkSchema], default: [] },
    ...baseFields,
  },
  { ...baseSchemaOptions, minimize: false },
);

// A number is handed out once, ever: unique over every contract, deleted ones included.
vehicleContractSchema.index({ no: 1 }, { name: 'ux_vehicle_contract_no', unique: true });
// The list, newest contract first.
vehicleContractSchema.index({ date: -1, no: -1 }, { name: 'ix_vehicle_contract_date' });
// «إنذار التوريد» narrows on the deadline before it computes what is still owed.
vehicleContractSchema.index({ deadline: 1 }, { name: 'ix_vehicle_contract_deadline' });
// «الماركة» filters on any line's make.
vehicleContractSchema.index({ 'lines.typeId': 1 }, { name: 'ix_vehicle_contract_type' });
// «المورد» filters, and `/suppliers` lists the distinct names.
vehicleContractSchema.index({ supplier: 1 }, { name: 'ix_vehicle_contract_supplier' });

export const FleetVehicleContractModel = model<FleetVehicleContractDoc>(
  'FleetVehicleContract',
  vehicleContractSchema,
  'fleet_vehicle_contracts',
);
