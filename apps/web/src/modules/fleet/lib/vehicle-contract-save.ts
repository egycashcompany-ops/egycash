// «حفظ العقد» — the editor's save, as one ordered sequence, React-free so a spec can follow it:
//
//   NEW   POST the contract → upload the waiting files one by one, in the order the tray shows
//         them (the server keeps upload order, so nothing more is needed).
//   EDIT  PATCH the contract with its version → remove the attachments taken out of the tray →
//         upload the new ones in order → PUT the final order, when it differs from what the server
//         now holds.
//
// The contract itself is the save: if it is refused, nothing else is sent and the form stays open.
// A file that then fails to upload does not undo it — the contract is kept and the screen says
// which files to add again from the contract's page (in the spirit of `saveThenAttachPhoto`).
import {
  type CreateFleetVehicleContract,
  type FleetVehicleContractDto,
  type FleetVehicleContractFileDto,
  type UpdateFleetVehicleContract,
} from '@ecms/contracts';
import { type UploadProgressOptions } from '../../../shared/lib/api-client';

/** One tile of the tray: an attachment the server holds, or a file waiting for Save. */
export type TrayItem =
  | { kind: 'saved'; key: string; file: FleetVehicleContractFileDto }
  | {
      kind: 'pending';
      key: string;
      file: File;
      /** 0–100 while it goes up; `null` while it waits. */
      progress: number | null;
    };

/** The calls the sequence makes — the real api in the screen, stubs in a spec. */
export interface ContractSaveApi {
  create: (body: CreateFleetVehicleContract) => Promise<FleetVehicleContractDto>;
  update: (id: string, body: UpdateFleetVehicleContract) => Promise<FleetVehicleContractDto>;
  upload: (
    id: string,
    file: File,
    options: UploadProgressOptions,
  ) => Promise<FleetVehicleContractFileDto>;
  removeFile: (id: string, fileId: string) => Promise<void>;
  order: (id: string, fileIds: readonly string[]) => Promise<FleetVehicleContractDto>;
}

export type ContractSavePlan =
  | { mode: 'create'; body: CreateFleetVehicleContract; items: readonly TrayItem[] }
  | {
      mode: 'update';
      id: string;
      body: UpdateFleetVehicleContract;
      /** The live attachments as the contract was read, in their order. */
      before: readonly FleetVehicleContractFileDto[];
      items: readonly TrayItem[];
    };

export interface ContractSaveResult {
  contract: FleetVehicleContractDto;
  /** The names of the files that could not be uploaded (or removed). */
  failed: string[];
  /** The final order could not be written — somebody else changed the attachments meanwhile. */
  orderRefused: boolean;
}

export interface ContractSaveHooks {
  /** A waiting file's percentage as it goes up. */
  onProgress?: (key: string, percent: number) => void;
  /** Lets one waiting file be cancelled while it goes up; a cancelled file is simply not added. */
  signalOf?: (key: string) => AbortSignal | undefined;
}

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === 'AbortError';

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const saveContractWithFiles = async (
  api: ContractSaveApi,
  plan: ContractSavePlan,
  hooks: ContractSaveHooks = {},
): Promise<ContractSaveResult> => {
  const contract =
    plan.mode === 'create' ? await api.create(plan.body) : await api.update(plan.id, plan.body);
  const failed: string[] = [];

  // EDIT: the attachments taken out of the tray go first, so the order below names the live set.
  const kept = new Set(
    plan.items.flatMap((item) => (item.kind === 'saved' ? [item.file.fileId] : [])),
  );
  const removed = plan.mode === 'update' ? plan.before.filter((f) => !kept.has(f.fileId)) : [];
  const stillThere: string[] = [];
  for (const file of removed) {
    try {
      await api.removeFile(contract.id, file.fileId);
    } catch {
      failed.push(file.fileName);
      stillThere.push(file.fileId);
    }
  }

  // The waiting files, one by one, in the tray's order.
  const uploaded = new Map<string, string>();
  for (const item of plan.items) {
    if (item.kind !== 'pending') continue;
    const signal = hooks.signalOf?.(item.key);
    try {
      const saved = await api.upload(contract.id, item.file, {
        onProgress: (percent) => hooks.onProgress?.(item.key, percent),
        ...(signal === undefined ? {} : { signal }),
      });
      uploaded.set(item.key, saved.fileId);
    } catch (error) {
      if (!isAbort(error)) failed.push(item.file.name);
    }
  }

  let orderRefused = false;
  if (plan.mode === 'update') {
    // What the server holds now: the earlier attachments still there, then the new ones as they
    // went up; what the tray shows: its order, with each new file at its place.
    const stillHeld = plan.before.filter(
      (f) => kept.has(f.fileId) || stillThere.includes(f.fileId),
    );
    const held = [...stillHeld.map((f) => f.fileId), ...uploaded.values()];
    const shown = [
      ...plan.items
        .flatMap((item) =>
          item.kind === 'saved' ? [item.file.fileId] : [uploaded.get(item.key) ?? ''],
        )
        .filter((id) => id !== ''),
      ...stillThere,
    ];
    if (held.length > 1 && !sameOrder(held, shown)) {
      try {
        await api.order(contract.id, shown);
      } catch {
        orderRefused = true;
      }
    }
  }
  return { contract, failed, orderRefused };
};

/**
 * May this reader add pages to the contract? `edit` on any contract; `create` alone on the ones they
 * saved — the API's own rule, so the screen never offers an upload the server refuses.
 */
export const mayAddContractFiles = (
  can: (permission: string) => boolean,
  meId: string | null,
  contract: Pick<FleetVehicleContractDto, 'createdBy'>,
): boolean =>
  can('fleetVehicleContract.edit') ||
  (can('fleetVehicleContract.create') && meId !== null && contract.createdBy === meId);
