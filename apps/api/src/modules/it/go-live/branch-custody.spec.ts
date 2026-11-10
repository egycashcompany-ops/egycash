// The branches' custody reaches the company by DEPLOYING, and what it writes is the reviewed file —
// the file is held to the owner's review here (four sheets, «كل فرع فى فرعه»; «انقلهم لفرع الملف»;
// «لو مفيش تاجات فخلاص متضيفهمش»; «طابعتين مختلفتين»; «أكمّل الناقص بس»), with the deploy's caller
// and the steps it waits for. The planner is `branch-custody-import.spec.ts`; the writing itself is
// proved against a real mongo in `tests/integration/it-go-live-branch-custody.spec.ts`.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAioOctober } from './aio-october-import';
import { IT_AIO_OCTOBER_MARK, resolveAioOctoberFile } from './aio-october';
import { IT_ASSET_SPECS_MARK } from './asset-specs';
import {
  parseBranchCustody,
  type BranchCustodyFile,
  type CustodyRow,
} from './branch-custody-import';
import {
  BRANCH_CUSTODY_AFTER,
  BRANCH_CUSTODY_FILE,
  IT_BRANCH_CUSTODY_MARK,
  resolveBranchCustodyFile,
} from './branch-custody';
import { IT_INVENTORY_MARK, resolveInventoryFile } from './inventory';
import { parseInventory, type InventoryCategoryKey } from './inventory-import';

const HERE = dirname(fileURLToPath(import.meta.url));
const API_ROOT = join(HERE, '..', '..', '..', '..');

/** Source with comments removed: a call commented out must not keep the guard green. */
const code = (path: string): string =>
  readFileSync(join(API_ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const raw = (): string => {
  const file = resolveBranchCustodyFile();
  if (file === null) throw new Error(`${BRANCH_CUSTODY_FILE} is not where the go-live looks`);
  return readFileSync(file, 'utf8');
};

const committed = (): BranchCustodyFile => parseBranchCustody(JSON.parse(raw()));

/** The October inventory's devices, as its committed file has them. */
const inventoryDevices = () => {
  const inventory = resolveInventoryFile();
  if (inventory === null) throw new Error('the inventory file is not where the go-live looks');
  return parseInventory(JSON.parse(readFileSync(inventory, 'utf8'))).devices;
};

/** The serials the inventory and the October batch registered, each with its branch. */
const registered = (): Map<string, string> => {
  const aio = resolveAioOctoberFile();
  if (aio === null) throw new Error('the October file is not where the go-live looks');
  const register = new Map<string, string>();
  for (const device of inventoryDevices()) {
    if (device.serial !== null) register.set(device.serial.toUpperCase(), device.branch);
  }
  const october = parseAioOctober(JSON.parse(readFileSync(aio, 'utf8')));
  for (const device of october.devices) register.set(device.serial.toUpperCase(), october.branch);
  return register;
};

/** The same serials, each with the kind of device the inventory or the October batch made it. */
const registeredCategories = (): Map<string, InventoryCategoryKey> => {
  const aio = resolveAioOctoberFile();
  if (aio === null) throw new Error('the October file is not where the go-live looks');
  const register = new Map<string, InventoryCategoryKey>();
  for (const device of inventoryDevices()) {
    if (device.serial !== null) register.set(device.serial.toUpperCase(), device.category);
  }
  const october = parseAioOctober(JSON.parse(readFileSync(aio, 'utf8')));
  for (const device of october.devices) {
    register.set(device.serial.toUpperCase(), october.template.category);
  }
  return register;
};

const where = (row: CustodyRow): string => `${row.sheet} ${row.row}`;

const sameSerial = (a: string, b: string): boolean => a.toUpperCase() === b.toUpperCase();

/** Whether an inventory device's notes name a label — asked, never printed: they hold names. */
const namedIn = (notes: string | null, label: string): boolean =>
  notes !== null && notes.toUpperCase().includes(label.toUpperCase());

/** The single-character edits (Levenshtein) from one label to another — a misread is one or two. */
const editsBetween = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, substitution));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
};

describe('the branches’ custody is added by the deploy', () => {
  it.each(['src/server.ts', 'src/worker.ts'])('%s starts it, after the specifications', (file) => {
    const source = code(file);
    expect(source).toContain('startItBranchCustodyGoLive();');
    expect(source.indexOf('startItBranchCustodyGoLive();')).toBeGreaterThan(
      source.indexOf('startItAssetSpecsGoLive();'),
    );
  });

  it('runs once per version of the file', () => {
    expect(IT_BRANCH_CUSTODY_MARK).toBe('go-live:it-branch-custody-2026-11:v1');
    expect(IT_BRANCH_CUSTODY_MARK).toMatch(/:v\d+$/u);
  });

  it('waits for the inventory, the October all-in-ones and the specifications', () => {
    expect([...BRANCH_CUSTODY_AFTER]).toEqual([
      IT_INVENTORY_MARK,
      IT_AIO_OCTOBER_MARK,
      IT_ASSET_SPECS_MARK,
    ]);
    const source = code('src/modules/it/go-live/branch-custody.ts');
    expect(source).toContain('for (const mark of BRANCH_CUSTODY_AFTER)');
    expect(source).toContain('isItGoLiveRunDone(mark)');
  });

  it('writes each device only as it was read — and moves one only while it is in stock', () => {
    const source = code('src/modules/it/go-live/branch-custody.ts');
    expect(source).toContain('...versionOf(row)');
    expect(source).toContain('$inc: { __v: 1 }');
    expect(source).toContain("{ status: 'inStock', currentAssignmentId: null }");
    expect(source).toContain('result.matchedCount !== 1');
  });

  // A location names a place inside the branch the device has left: the move's own write clears it.
  it('clears a moved device’s place in the branch it left, in the write that moves it', () => {
    const source = code('src/modules/it/go-live/branch-custody.ts');
    expect(source).toContain('{ branchId: new Types.ObjectId(move.toBranchId), location: null }');
    expect(source).toContain('location: 1,');
    expect(source).toContain('transferredHistoryNote(decision.row, decision.move.location)');
    expect(source).toContain("{ field: 'location', old: decision.move.location, new: null }");
  });
});

describe('the committed file is the reviewed one', () => {
  const { devices } = committed();

  // The sheet's word for a kind, as the file's own new lines file it.
  const categories = new Map(
    devices.flatMap((row) => (row.action === 'new' ? [[row.kind, row.category] as const] : [])),
  );
  const categoryOf = (row: CustodyRow) => {
    const category = categories.get(row.kind);
    if (category === undefined) throw new Error(`${where(row)}: no new line files ${row.kind}`);
    return category;
  };

  it('holds the four sheets’ 199 lines, in sheet order', () => {
    expect(devices).toHaveLength(199);
    const sheets = [...new Set(devices.map((row) => row.branch))];
    expect(sheets).toEqual(['بورسعيد', 'طنطا', 'الشروق', 'أكتوبر']);
    for (const branch of sheets) {
      const rows = devices.filter((row) => row.branch === branch).map((row) => row.row);
      expect(rows).toEqual([...rows].sort((a, b) => a - b));
    }
  });

  it('decides each line as the review did', () => {
    const counts: Record<string, Record<string, number>> = {};
    for (const row of devices) {
      const branch = (counts[row.branch] ??= {});
      branch[row.action] = (branch[row.action] ?? 0) + 1;
    }
    expect(counts).toEqual({
      بورسعيد: { fill: 35, new: 30 },
      طنطا: { fill: 31, move: 2, new: 8, skip: 2 },
      الشروق: { fill: 19, move: 4, new: 12, skip: 2 },
      أكتوبر: { fill: 46, move: 2, new: 2, skip: 4 },
    });
    const totals: Record<string, number> = {};
    for (const row of devices) totals[row.action] = (totals[row.action] ?? 0) + 1;
    expect(totals).toEqual({ fill: 131, move: 8, new: 52, skip: 8 });
  });

  it('finds every line the review matched on the register — in its branch, or the one it moves from', () => {
    const register = registered();
    for (const row of devices) {
      if (row.action !== 'fill' && row.action !== 'move') continue;
      const branch = register.get(row.registerSerial.toUpperCase());
      expect(branch, where(row)).toBeDefined();
      expect(branch, where(row)).toBe(row.action === 'move' ? row.fromBranch : row.branch);
    }
  });

  it('moves from October — the «MP30EP…» are its all-in-one batch — and from the head office', () => {
    const moves = devices.flatMap((row) => (row.action === 'move' ? [row] : []));
    expect(moves.map((row) => [row.branch, row.row, row.registerSerial, row.fromBranch])).toEqual([
      ['طنطا', 17, 'MP30EPDE', 'أكتوبر'],
      ['طنطا', 25, '1YGKHC3', 'المهندسين'],
      ['الشروق', 16, 'MP30EPE1', 'أكتوبر'],
      ['الشروق', 17, 'MP30EPF3', 'أكتوبر'],
      ['الشروق', 18, 'MP30EPEV', 'أكتوبر'],
      // Not الشروق 25 nor 27: their serials are disputed, and they are left out (below).
      ['الشروق', 26, '46YMRS3', 'المهندسين'],
      ['أكتوبر', 64, 'CNDRP8Z4KV', 'المهندسين'],
      ['أكتوبر', 65, 'FCH2402D9S4', 'المهندسين'],
    ]);
    expect([...new Set(moves.map((row) => row.fromBranch))].sort()).toEqual([
      'أكتوبر',
      'المهندسين',
    ]);
    const aio = resolveAioOctoberFile();
    if (aio === null) throw new Error('the October file is not where the go-live looks');
    const batch = new Set(
      parseAioOctober(JSON.parse(readFileSync(aio, 'utf8'))).devices.map((device) => device.serial),
    );
    const allInOnes = moves.filter((row) => row.registerSerial.startsWith('MP30EP'));
    expect(allInOnes.map((row) => [row.branch, row.registerSerial])).toEqual([
      ['طنطا', 'MP30EPDE'],
      ['الشروق', 'MP30EPE1'],
      ['الشروق', 'MP30EPF3'],
      ['الشروق', 'MP30EPEV'],
    ]);
    for (const row of allInOnes) {
      expect(batch.has(row.registerSerial), where(row)).toBe(true);
      expect(row.fromBranch, where(row)).toBe('أكتوبر');
    }
  });

  // Shorouk's sheet gave its 13 Dell OptiPlex desktops (rows 2–14), word for word, the processor
  // and graphics of its all-in-ones (16–18): «Intel(R) Core(TM) 5 210H …», the Lenovo neo 50a's
  // soldered laptop chip, which no OptiPlex holds. Those two rows of the table were dropped from
  // the 13 lines — their system and disks stand — so «أكمّل الناقص بس» never fills a desktop with
  // an all-in-one's chip. No line carries it but an all-in-one's: a found line by the kind the
  // register made its device, a `new` line by the category it is registered under.
  it('gives the all-in-ones’ «210H» chip to no other device — Shorouk’s desktops had copied it', () => {
    const hasChip = (row: CustodyRow): boolean =>
      row.action !== 'skip' && (row.specs.processor ?? '').toUpperCase().includes('210H');
    expect(devices.some(hasChip)).toBe(true);
    const categories = registeredCategories();
    for (const row of devices) {
      if (row.action === 'skip') continue;
      const category =
        row.action === 'new' ? row.category : categories.get(row.registerSerial.toUpperCase());
      expect(category, where(row)).toBeDefined();
      if (category !== 'allInOne') expect(hasChip(row), where(row)).toBe(false);
    }

    const desktops = devices.filter(
      (row) => row.branch === 'الشروق' && row.row >= 2 && row.row <= 14,
    );
    expect(desktops.map((row) => row.row)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    for (const row of desktops) {
      if (row.action === 'skip') throw new Error(`${where(row)} is left out`);
      expect(row.specs.processor, where(row)).toBeUndefined();
      expect(row.specs.displayAdapter, where(row)).toBeUndefined();
      expect(row.specs.systemType, where(row)).toBeDefined();
      expect(row.specs.storage, where(row)).toBeDefined();
    }

    const carrying: Record<string, number> = {};
    for (const row of devices) {
      if (row.action === 'skip') continue;
      for (const field of Object.keys(row.specs)) carrying[field] = (carrying[field] ?? 0) + 1;
    }
    expect(carrying).toEqual({
      processor: 62,
      memory: 74,
      systemType: 75,
      storage: 75,
      displayAdapter: 62,
    });
  });

  // Shorouk 14 (2HGSWV3) is, on the register, an OptiPlex 7000 of rows 2–11's «…GSWV3» batch — yet
  // its line repeated rows 12–13, the two OptiPlex 7090s, in its name, its model AND its memory
  // «(4+8) 12». That memory is theirs, so it was dropped: «أكمّل الناقص بس» never fills a 7000 with
  // a 7090's memory. Rows 2–13 keep theirs.
  it('gives Shorouk 14 no memory — the one its line carried is the two OptiPlex 7090s’ above it', () => {
    const shorouk = new Map(
      devices.flatMap((row) =>
        row.branch === 'الشروق' && (row.action === 'fill' || row.action === 'move')
          ? [[row.row, row] as const]
          : [],
      ),
    );
    const line = (row: number) => {
      const found = shorouk.get(row);
      if (found === undefined) throw new Error(`عهدة فرع الشروق ${row} is not a found line`);
      return found;
    };
    const models = new Map(
      inventoryDevices().flatMap((device) =>
        device.serial === null ? [] : [[device.serial.toUpperCase(), device.model] as const],
      ),
    );
    const modelOf = (row: number) => models.get(line(row).registerSerial.toUpperCase());
    expect(modelOf(14)).toBeDefined();
    expect(modelOf(14)).toBe(modelOf(2));
    expect(modelOf(14)).not.toBe(modelOf(12));
    expect(modelOf(12)).toBe(modelOf(13));

    expect(line(14).specs.memory).toBeUndefined();
    for (let row = 2; row <= 13; row += 1) {
      expect(line(row).specs.memory, where(line(row))).toBeDefined();
    }
  });

  it('registers as new only what neither the inventory nor the October batch holds', () => {
    const register = registered();
    for (const row of devices) {
      if (row.action !== 'new') continue;
      for (const id of [row.serial, row.tag]) {
        if (id !== null) expect(register.has(id.toUpperCase()), where(row)).toBe(false);
      }
    }
  });

  it('registers the Tanta printer beside the register’s near-twin — «طابعتين مختلفتين»', () => {
    expect(registered().get('CNDRP8Z69Y')).toBe('طنطا');
    expect(
      devices.filter((row) => row.serial === 'CNDRPB8Z69Y').map((row) => [row.sheet, row.action]),
    ).toEqual([['عهدة فرع طنطا', 'new']]);
  });

  it('leaves out exactly the lines the review held for the owner, each for its reason', () => {
    const skipped = devices.flatMap((row) =>
      row.action === 'skip' ? [[row.branch, row.row, row.reason]] : [],
    );
    expect(skipped).toEqual([
      ['طنطا', 24, 'repeatedSerial'],
      ['طنطا', 43, 'repeatedSerial'],
      ['الشروق', 25, 'serialDisputed'],
      ['الشروق', 27, 'serialDisputed'],
      ['أكتوبر', 6, 'notASerial'],
      ['أكتوبر', 28, 'noSerialOrTag'],
      ['أكتوبر', 29, 'noSerialOrTag'],
      ['أكتوبر', 39, 'nearSerial'],
    ]);
    // A repeated serial is another line's, on the same sheet.
    for (const row of devices) {
      if (row.action !== 'skip' || row.reason !== 'repeatedSerial') continue;
      const twins = devices.filter(
        (other) => other !== row && other.sheet === row.sheet && other.serial === row.serial,
      );
      expect(twins, where(row)).toHaveLength(1);
    }
  });

  // The October inventory found the serial TWICE: it gave it to a device of another branch and
  // registered the other one without a serial, its notes naming the repeated one. That other one
  // is not always in the sheet's branch: Shorouk's printer (27) is at Shorouk, but the screen's
  // (25) is the head office's — kept in its IT store beside 46YMRS3, which the Shorouk sheet's
  // very next line (26) moves from the head office, so Shorouk's screen is probably that one.
  // Moving the device that holds the serial would write a transfer nobody can take back — so the
  // line is left out, and the owner reads the labels. The notes hold people's names: only
  // `.includes` is asked of them, and nothing of them is printed.
  it('leaves out a serial the inventory gave to another branch’s device — its twin registered without one', () => {
    const inventory = inventoryDevices();
    const disputed = devices.flatMap((row) =>
      row.action === 'skip' && row.reason === 'serialDisputed' ? [row] : [],
    );
    expect(disputed.map(where)).toEqual(['عهدة فرع الشروق 25', 'عهدة فرع الشروق 27']);
    for (const row of disputed) {
      const serial = row.serial ?? row.tag;
      if (serial === null) throw new Error(`${where(row)} disputes no serial`);
      const holders = inventory.filter(
        (device) => device.serial !== null && sameSerial(device.serial, serial),
      );
      expect(holders.length, where(row)).toBeGreaterThan(0);
      for (const device of holders) expect(device.branch, where(row)).not.toBe(row.branch);
      const category = categoryOf(row);
      const twins = inventory.filter(
        (device) =>
          device.category === category && device.serial === null && namedIn(device.notes, serial),
      );
      expect(twins.length, where(row)).toBeGreaterThan(0);
    }
  });

  // The other way round: a label the October review marked «found twice» is never filled, moved
  // or registered — every such line is a `serialDisputed` one, left out above.
  it('writes no line whose label the inventory’s notes name beside a device it left without a serial', () => {
    const twins = inventoryDevices().filter((device) => device.serial === null);
    expect(twins.some((device) => device.notes !== null)).toBe(true);
    for (const row of devices) {
      if (row.action === 'skip') continue;
      const labels = [row.serial, row.tag, row.action === 'new' ? null : row.registerSerial];
      for (const label of labels) {
        if (label === null) continue;
        expect(
          twins.some((device) => namedIn(device.notes, label)),
          `${where(row)}: ${label}`,
        ).toBe(false);
      }
    }
  });

  // October's sheet gives a screen B3SZ8V3 — two characters off B3ZY8V3, an October screen the
  // October sheet does not list. Most likely that very screen, its label misread: registering it
  // as new could count one screen twice, so the owner reads the label.
  it('leaves out a label two edits off a device of its branch that no line names — likely it, misread', () => {
    expect(editsBetween('KITTEN', 'SITTING')).toBe(3);
    expect(editsBetween('B3SZ8V3', 'B3ZY8V3')).toBe(2);
    const inventory = inventoryDevices();
    const register = registered();
    const named = new Set(
      devices.flatMap((row) =>
        row.action === 'fill' || row.action === 'move' ? [row.registerSerial.toUpperCase()] : [],
      ),
    );
    const near = devices.flatMap((row) =>
      row.action === 'skip' && row.reason === 'nearSerial' ? [row] : [],
    );
    expect(near.map(where)).toEqual(['عهدة فرع أكتوبر 39']);
    for (const row of near) {
      const labels = [row.serial, row.tag].flatMap((id) => (id === null ? [] : [id.toUpperCase()]));
      expect(labels.length, where(row)).toBeGreaterThan(0);
      for (const label of labels)
        expect(register.has(label), `${where(row)}: ${label}`).toBe(false);
      const category = categoryOf(row);
      const unnamed = inventory.flatMap((device) =>
        device.branch === row.branch &&
        device.category === category &&
        device.serial !== null &&
        !named.has(device.serial.toUpperCase())
          ? [device.serial.toUpperCase()]
          : [],
      );
      expect(
        unnamed.some((serial) => labels.some((label) => editsBetween(serial, label) <= 2)),
        where(row),
      ).toBe(true);
    }
  });

  // HP's «…AV» is the product number of the build — every unit of it carries the same one; the
  // register's HP desktops carry their «CZC…» serials. It identifies no one device.
  it('leaves out a line whose only label is HP’s product number', () => {
    const product = devices.flatMap((row) =>
      row.action === 'skip' && row.reason === 'notASerial' ? [row] : [],
    );
    expect(product.map(where)).toEqual(['عهدة فرع أكتوبر 6']);
    for (const row of product) {
      expect(row.serial, where(row)).toBeNull();
      expect(row.tag, where(row)).toMatch(/^[A-Z0-9]{5}AV$/u);
    }
  });

  it('gives no two lines that are written one identifier', () => {
    const seen = new Map<string, string>();
    for (const row of devices) {
      if (row.action === 'skip') continue;
      for (const id of new Set(
        [row.serial, row.tag].flatMap((v) => (v === null ? [] : [v.toUpperCase()])),
      )) {
        expect(seen.get(id), `${where(row)}: ${id}`).toBeUndefined();
        seen.set(id, where(row));
      }
    }
  });

  it('matches the register as it keeps a Dell: the service tag is the serial', () => {
    const profile = (action: CustodyRow['action']) => {
      const counts = { serialOnly: 0, tagOnly: 0, both: 0 };
      for (const row of devices) {
        if (row.action !== action) continue;
        if (row.serial !== null && row.tag !== null) counts.both += 1;
        else if (row.tag !== null) counts.tagOnly += 1;
        else counts.serialOnly += 1;
      }
      return counts;
    };
    expect(profile('fill')).toEqual({ serialOnly: 46, tagOnly: 70, both: 15 });
    // October's 6 and 39 were tag-only new lines until the review held them for the owner.
    expect(profile('new')).toEqual({ serialOnly: 47, tagOnly: 4, both: 1 });
    for (const row of devices) {
      if (row.action === 'skip' || row.action === 'new') continue;
      expect(row.registerSerial, where(row)).toBe(row.tag ?? row.serial);
    }
  });

  // The sheets say whose desk a device is on; none of it travels.
  it('carries the device and nothing else — no holder, employee or national ID', () => {
    expect(raw()).not.toMatch(/\b[23]\d{13}\b/u);
    const common = ['action', 'branch', 'kind', 'row', 'serial', 'sheet', 'tag'];
    const allowed: Record<CustodyRow['action'], string[]> = {
      fill: [...common, 'accessories', 'registerSerial', 'specs'],
      move: [...common, 'accessories', 'fromBranch', 'registerSerial', 'specs'],
      new: [...common, 'accessories', 'category', 'manufacturer', 'model', 'name', 'note', 'specs'],
      skip: [...common, 'reason'],
    };
    for (const row of devices) {
      expect(Object.keys(row).sort(), where(row)).toEqual(allowed[row.action].sort());
      if (row.action === 'new' && row.note !== null) {
        expect(row.note, where(row)).toMatch(/^رقم الهاتف في الملف: \d+$/u);
      }
    }
  });
});
