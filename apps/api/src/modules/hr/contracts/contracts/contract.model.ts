// The Contract aggregate (frozen design D2/D3 + Rev 1/2). One document per contract
// VERSION in the amendment chain; the generated snapshot (html + variables + integrity)
// is frozen at generation and never updated (A2/A3/A20) — signed/archived documents are
// fully immutable (A4).
import { Schema, model, type Types } from 'mongoose';

import {
  type ContractAttachmentCategory,
  type ContractGenerationStatus,
  type ContractStatus,
  type ContractTemplateLanguage,
  type ContractVariableSource,
} from '@ecms/contracts';
import { baseFields, baseSchemaOptions, type BaseDocFields } from '../../../../shared/base/base.model';

export interface ContractVariableValue {
  key: string;
  value: string;
  source: ContractVariableSource;
  overriddenBy: Types.ObjectId | null;
}

export interface ContractSigner {
  key: string;
  label: string;
  status: 'pending' | 'signed' | 'declined';
  method: 'manual';
  signedAt: Date | null;
  recordedBy: Types.ObjectId | null;
  evidenceFileId: Types.ObjectId | null;
  note: string | null;
}

export interface ContractApprovalStep {
  step: number;
  decidedBy: Types.ObjectId;
  decision: 'approved' | 'rejected';
  note: string | null;
  at: Date;
}

export interface ContractAttachment {
  attachmentId: Types.ObjectId;
  fileId: Types.ObjectId;
  category: ContractAttachmentCategory;
  label: string;
  addedBy: Types.ObjectId;
  addedAt: Date;
}

export interface ContractDoc extends BaseDocFields {
  code: string;
  referenceNumber: string | null;
  employeeId: Types.ObjectId;
  employeeName: string;
  employeeCode: string;
  branchId: Types.ObjectId | null;
  typeId: Types.ObjectId;
  templateKey: string;
  templateId: Types.ObjectId;
  /** Pinned at generation (A2); null while draft. */
  pinnedTemplateVersion: number | null;
  templateLanguage: ContractTemplateLanguage;
  status: ContractStatus;
  contractVersion: number;
  parentContractId: Types.ObjectId | null;
  supersededById: Types.ObjectId | null;
  startDate: Date;
  endDate: Date | null;
  /** Lean reads return a plain object; the schema stores a Map. */
  overrides: Record<string, string>;
  /** Frozen at generation with provenance (A3). */
  variables: ContractVariableValue[];
  /** The immutable rendered snapshot (A20); null while draft. */
  renderedHtml: string | null;
  generation: {
    status: ContractGenerationStatus;
    error: string | null;
    requestedAt: Date | null;
    completedAt: Date | null;
    integrity: {
      sha256: string;
      generatedAt: Date;
      generatorVersion: string;
      templateVersion: number;
      contractVersion: number;
    } | null;
    pdfFileId: Types.ObjectId | null;
  };
  signers: ContractSigner[];
  approval: { required: boolean; steps: ContractApprovalStep[] } | null;
  attachments: ContractAttachment[];
  terminatedAt: Date | null;
  terminatedBy: Types.ObjectId | null;
  terminationReason: string | null;
  /** D11 — one expiring-soon notice per contract. */
  expiryNoticeSentAt: Date | null;
}

const integritySchema = new Schema(
  {
    sha256: { type: String, required: true },
    generatedAt: { type: Date, required: true },
    generatorVersion: { type: String, required: true },
    templateVersion: { type: Number, required: true },
    contractVersion: { type: Number, required: true },
  },
  { _id: false },
);

const approvalSchema = new Schema(
  {
    required: { type: Boolean, required: true },
    steps: {
      type: [
        {
          _id: false,
          step: { type: Number, required: true },
          decidedBy: { type: Schema.Types.ObjectId, required: true },
          decision: { type: String, enum: ['approved', 'rejected'], required: true },
          note: { type: String, default: null },
          at: { type: Date, required: true },
        },
      ],
      default: [],
    },
  },
  { _id: false },
);

const contractSchema = new Schema<ContractDoc>(
  {
    code: { type: String, required: true },
    referenceNumber: { type: String, default: null },
    employeeId: { type: Schema.Types.ObjectId, required: true },
    employeeName: { type: String, required: true },
    employeeCode: { type: String, required: true },
    branchId: { type: Schema.Types.ObjectId, default: null },
    typeId: { type: Schema.Types.ObjectId, required: true },
    templateKey: { type: String, required: true },
    templateId: { type: Schema.Types.ObjectId, required: true },
    pinnedTemplateVersion: { type: Number, default: null },
    templateLanguage: { type: String, enum: ['ar', 'en'], required: true },
    status: {
      type: String,
      enum: [
        'draft', 'pendingApproval', 'approved', 'active', 'signed',
        'amended', 'renewed', 'terminated', 'expired', 'archived',
      ],
      default: 'draft',
    },
    contractVersion: { type: Number, default: 1 },
    parentContractId: { type: Schema.Types.ObjectId, default: null },
    supersededById: { type: Schema.Types.ObjectId, default: null },
    startDate: { type: Date, required: true },
    endDate: { type: Date, default: null },
    overrides: { type: Map, of: String, default: {} },
    variables: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          value: { type: String, required: true },
          source: { type: String, required: true },
          overriddenBy: { type: Schema.Types.ObjectId, default: null },
        },
      ],
      default: [],
    },
    renderedHtml: { type: String, default: null },
    generation: {
      status: { type: String, enum: ['idle', 'queued', 'rendering', 'completed', 'failed'], default: 'idle' },
      error: { type: String, default: null },
      requestedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      integrity: { type: integritySchema, default: null },
      pdfFileId: { type: Schema.Types.ObjectId, default: null },
    },
    signers: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          label: { type: String, required: true },
          status: { type: String, enum: ['pending', 'signed', 'declined'], default: 'pending' },
          method: { type: String, enum: ['manual'], default: 'manual' },
          signedAt: { type: Date, default: null },
          recordedBy: { type: Schema.Types.ObjectId, default: null },
          evidenceFileId: { type: Schema.Types.ObjectId, default: null },
          note: { type: String, default: null },
        },
      ],
      default: [],
    },
    approval: { type: approvalSchema, default: null },
    attachments: {
      type: [
        {
          _id: false,
          attachmentId: { type: Schema.Types.ObjectId, required: true },
          fileId: { type: Schema.Types.ObjectId, required: true },
          category: { type: String, enum: ['nda', 'annex', 'signedCopy', 'approval', 'other'], required: true },
          label: { type: String, required: true },
          addedBy: { type: Schema.Types.ObjectId, required: true },
          addedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    terminatedAt: { type: Date, default: null },
    terminatedBy: { type: Schema.Types.ObjectId, default: null },
    terminationReason: { type: String, default: null },
    expiryNoticeSentAt: { type: Date, default: null },
    ...baseFields,
  },
  baseSchemaOptions,
);

contractSchema.index({ code: 1, contractVersion: 1 }, { unique: true, name: 'ux_code_version' });
contractSchema.index({ employeeId: 1, typeId: 1, status: 1 }, { name: 'ix_employee_type_status' });
contractSchema.index({ status: 1, endDate: 1 }, { name: 'ix_status_endDate' });
// A12 — free-text search surface.
contractSchema.index(
  { code: 'text', employeeName: 'text', employeeCode: 'text', referenceNumber: 'text' },
  { name: 'tx_search' },
);

export const ContractModel = model<ContractDoc>('HrContract', contractSchema, 'hr_contracts');
