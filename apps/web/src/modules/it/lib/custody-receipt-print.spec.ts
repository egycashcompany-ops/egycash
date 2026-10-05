// The printed acknowledgment is the IT department's «إقرار استلام» — every part the owner's form
// has, in its words, one page per device, filled in with what the system knows: the employee's
// name and job, the device's kind, serial, specifications and accessories, and the paper's own
// number in the footer. And since the tab inherits the app's Content-Security-Policy, nothing in it
// may depend on a script of its own.
import { describe, expect, it } from 'vitest';
import { type ItCustodyReceiptDocumentDto, type ItCustodyReceiptLineDto } from '@ecms/contracts';
import {
  buildCustodyReceiptHtml,
  RECEIPT_UNDERTAKING,
  receiptDate,
  receiptNumberLabel,
  specGroups,
} from './custody-receipt-print';

const LABELS = { print: 'طباعة الإيصال', close: 'إغلاق' };

const LAPTOP: ItCustodyReceiptLineDto = {
  assetId: '000000000000000000000001',
  assignmentId: null,
  assetCode: 'AST-00001',
  name: 'Dell Inspiron N4050',
  serialNumber: 'B600DN3',
  conditionOnIssue: 'N',
  notes: null,
  deviceType: 'لاب توب',
  manufacturer: 'Dell',
  model: 'N4050',
  specs: {
    processor: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache',
    memory: '4.00 GB RAM',
    systemType: '64-bit Operating System',
    storage: '500 GB',
    mediaDrive: 'CD/DVD RW',
    displayAdapter: 'Intel® HD Graphic 3000 Family',
    graphicsMemory: '1 GB',
    networkAdapters: ['Dell Wireless 1701 802.11 b/g/n', 'Realtec PCIe FE Family Controller'],
  },
  accessories: ['شاحن لاب توب'],
};

const SCREEN: ItCustodyReceiptLineDto = {
  assetId: '000000000000000000000002',
  assignmentId: null,
  assetCode: 'AST-00002',
  name: 'Dell Screen',
  serialNumber: '49WNRS3',
  conditionOnIssue: 'N',
  notes: null,
  deviceType: 'شاشة',
  manufacturer: null,
  model: null,
  specs: null,
  accessories: [],
};

const paper = (
  overrides: Partial<ItCustodyReceiptDocumentDto> = {},
): ItCustodyReceiptDocumentDto => ({
  formNumber: 7,
  issuedAt: '2023-08-30T09:00:00.000Z',
  employeeId: '000000000000000000000a01',
  employeeName: 'مصطفى عثمان محمود',
  employeeCode: '0100026',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  lines: [LAPTOP],
  ...overrides,
});

const pages = (html: string): string[] => html.split('<section class="page">').slice(1);

describe('the custody acknowledgment (إقرار استلام)', () => {
  const html = buildCustodyReceiptHtml(paper(), LABELS);

  it('carries the letterhead, the department’s banner and the title', () => {
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('<span>قطاع تكنولوجيا المعلومات</span>');
    expect(html).toContain('<polygon');
    expect(html).toContain('<h1>إقرار استلام</h1>');
    expect(html).toContain('<title>إقرار استلام EGYCASH-IT-F-14-0007 — مصطفى عثمان محمود</title>');
  });

  it('fills the statement in the form’s red with what the system knows', () => {
    expect(html).toContain('أقر أنا / <span class="fill"><bdi>مصطفى عثمان محمود</bdi></span>');
    expect(html).toContain('بوظيفة <span class="fill"><bdi>محاسب</bdi></span>');
    expect(html).toContain('بشركة إيجي كاش لتكنولوجيا الحلول النقدية');
    // «جهاز لاب توب» — the device's kind, then its serial, then the table it introduces.
    expect(html).toContain('بأنني قد استلمت جهاز <span class="fill"><bdi>لاب توب</bdi></span>');
    expect(html).toContain(
      'برقم مسلسل <span class="fill"><bdi>B600DN3</bdi></span> ومواصفاته كالتالي:',
    );
    expect(html).toMatch(/\.fill \{ color: #f00;/u);
  });

  it('leaves what the system does not hold — the national ID — as a dotted line for the pen', () => {
    expect(html).toMatch(/بطاقة رقم قومي <span class="fill">\.{8,}<\/span>/u);
    expect(html).toMatch(
      /صادرة من قسم <span class="fill">\.+<\/span> – <span class="fill">\.+<\/span>/u,
    );
    expect(html).toContain('بتاريخ <span class="fill">..../..../....</span>');
  });

  it('prints the specifications table the form has, its rows in its own words', () => {
    expect(html).toContain('<table class="specs" dir="ltr">');
    expect(html).toContain('<th>Component</th><th>Details</th>');
    for (const group of ['System', 'Storage', 'Graphics', 'Network']) {
      expect(html).toContain(`<tr class="group"><td class="g">${group}</td>`);
    }
    expect(html).toContain(
      '<td>Processor</td><td>Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache</td>',
    );
    // «Manufacturer / Model» is the asset's make and model.
    expect(html).toContain('<td>Manufacturer / Model</td><td>Dell / N4050</td>');
    // One row per network adapter.
    expect(html.match(/<td>Network Adapter<\/td>/gu)).toHaveLength(2);
  });

  it('lists the accessories, numbered in the form’s digits', () => {
    expect(html).toContain('<p class="lead">ومشتملاته كالتالي:</p>');
    expect(html).toContain('<div>١. شاحن لاب توب.</div>');
  });

  it('keeps the undertaking word for word, and the signature block on the left', () => {
    expect(html).toContain(RECEIPT_UNDERTAKING);
    expect(html).toContain('وهذا إقرار مني بذلك ،،،');
    expect(html).toContain('<div class="by">المقر بما فيه</div>');
    expect(html).toContain('<div>الاسم: مصطفى عثمان محمود</div>');
    expect(html).toContain('<div>التوقيع:</div>');
    expect(html).toContain('<div>التاريخ: ٣٠ / ٨ / ٢٠٢٣</div>');
    // In a right-to-left page the left half is reached by padding the RIGHT one.
    const rule = /^\s*\.signs \{([^}]*)\}/mu.exec(html)?.[1] ?? '';
    expect(rule).toContain('padding-right: 50%');
  });

  it('numbers the paper in its footer, beside the department', () => {
    // «ابدأ بـ 0001 وكل طباعة زود رقم» — the paper's own number, padded to four digits.
    expect(html).toContain('<b>EGYCASH</b> | IT Dept. | EGYCASH-IT-F-14-0007</span>');
    // One page: no page count in the footer's block.
    expect(html).toContain('<span class="block"></span>');
  });

  it('prints ONE PAGE PER DEVICE, under the one number, each counted in the footer', () => {
    const two = buildCustodyReceiptHtml(paper({ lines: [LAPTOP, SCREEN] }), LABELS);
    const [first, second] = pages(two);
    expect(pages(two)).toHaveLength(2);
    expect(first).toContain('<bdi>B600DN3</bdi>');
    expect(second).toContain('<bdi>49WNRS3</bdi>');
    expect(second).toContain('جهاز <span class="fill"><bdi>شاشة</bdi></span>');
    expect(first).toContain('EGYCASH-IT-F-14-0007</span>\n    <span class="block">1/2</span>');
    expect(second).toContain('EGYCASH-IT-F-14-0007</span>\n    <span class="block">2/2</span>');
    expect(two).toMatch(/\.page \{[^}]*break-after: page;/u);
  });

  it('a device with nothing on file prints no table and no accessories — the sentence ends there', () => {
    const [bare] = pages(buildCustodyReceiptHtml(paper({ lines: [SCREEN] }), LABELS));
    expect(bare).toContain('برقم مسلسل <span class="fill"><bdi>49WNRS3</bdi></span>.</p>');
    expect(bare).not.toContain('ومواصفاته كالتالي');
    expect(bare).not.toContain('<table');
    expect(bare).not.toContain('ومشتملاته');
  });

  it('a receipt from before the acknowledgment names the device by the asset’s own name', () => {
    const legacy = { ...SCREEN, deviceType: null };
    const [old] = pages(buildCustodyReceiptHtml(paper({ lines: [legacy] }), LABELS));
    expect(old).toContain('جهاز <span class="fill"><bdi>Dell Screen</bdi></span>');
  });

  it('a category already named «جهاز …» is not doubled', () => {
    const named = { ...SCREEN, deviceType: 'جهاز كمبيوتر مكتبي' };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [named] }), LABELS));
    expect(page).toContain('استلمت <span class="fill"><bdi>جهاز كمبيوتر مكتبي</bdi></span>');
  });

  it('leaves a line for the pen when the system cannot name the employee', () => {
    const blank = buildCustodyReceiptHtml(paper({ employeeName: null, jobTitle: null }), LABELS);
    expect(blank).toMatch(
      /أقر أنا \/ <span class="fill">\.{10,}<\/span> بوظيفة <span class="fill">\.{10,}<\/span>/u,
    );
    expect(blank).toContain('<div>الاسم: </div>');
  });

  it('shows each page as an A4 sheet in its tab, with a toolbar that is never printed', () => {
    const screen = html.slice(html.indexOf('@media screen {'));
    expect(screen).toContain('width: 210mm; min-height: 297mm');
    expect(html).toContain('@page { size: A4 portrait;');
    expect(html).toContain('.bar { display: none; }');
    // The form's shading and red block print even with the browser's background graphics off.
    expect(html).toContain('print-color-adjust: exact');
    // Wired from the app (`shared/lib/print-window.ts`), never by a handler of their own.
    expect(html).toContain('data-print>طباعة الإيصال</button>');
    expect(html).toContain('data-close>إغلاق</button>');
  });

  it('carries no script of its own — the tab inherits the app’s CSP and would never run it', () => {
    expect(html).not.toMatch(/<script/iu);
    expect(html).not.toMatch(/\son[a-z]+=/iu);
  });

  it('a receipt from before numbering prints the form’s bare prefix', () => {
    expect(receiptNumberLabel(null)).toBe('EGYCASH-IT-F-14');
    expect(receiptNumberLabel(1)).toBe('EGYCASH-IT-F-14-0001');
    expect(receiptNumberLabel(12345)).toBe('EGYCASH-IT-F-14-12345');
  });

  it('dates the signature block day / month / year in Arabic digits', () => {
    expect(receiptDate('2023-08-30T09:00:00.000Z')).toBe('٣٠ / ٨ / ٢٠٢٣');
  });

  it('escapes what people typed', () => {
    const hostile = buildCustodyReceiptHtml(
      paper({
        employeeName: '<script>x</script>',
        lines: [{ ...LAPTOP, accessories: ['<img src=x>'], model: '<b>' }],
      }),
      LABELS,
    );
    expect(hostile).not.toContain('<script>x</script>');
    expect(hostile).toContain('&lt;script&gt;');
    expect(hostile).toContain('١. &lt;img src=x&gt;.');
    expect(hostile).toContain('Dell / &lt;b&gt;');
  });
});

describe('the specifications table keeps only what was typed', () => {
  it('drops empty rows, and a group whose rows are all empty', () => {
    const groups = specGroups({
      ...LAPTOP,
      manufacturer: null,
      model: null,
      specs: {
        processor: 'Intel Core i5',
        memory: null,
        systemType: null,
        storage: '256 GB SSD',
        mediaDrive: null,
        displayAdapter: null,
        graphicsMemory: null,
        networkAdapters: [],
      },
    });
    expect(groups).toEqual([
      { group: null, rows: [{ label: 'Processor', value: 'Intel Core i5' }] },
      { group: 'Storage', rows: [{ label: 'Total size of hard disk(s)', value: '256 GB SSD' }] },
    ]);
  });

  it('prints the make alone when the model is unknown', () => {
    const [system] = specGroups({ ...SCREEN, manufacturer: 'Dell' });
    expect(system).toEqual({
      group: 'System',
      rows: [{ label: 'Manufacturer / Model', value: 'Dell' }],
    });
  });
});
