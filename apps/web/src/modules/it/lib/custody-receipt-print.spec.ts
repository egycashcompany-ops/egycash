// The printed acknowledgment is the IT department's «إقرار استلام» — every part the owner's form
// has, in its words, filled in with what the system knows: the employee's name and job, the
// device's kind, serial, specifications and accessories, and the paper's own number in the footer.
// A paper of one device is the form; a paper of several is ONE sheet — one statement, a table of
// the devices, one signature (2026-11-24). The words for the item agree with what is handed over.
// And since the tab inherits the app's Content-Security-Policy, nothing in it may depend on a
// script of its own.
import { describe, expect, it } from 'vitest';
import { type ItCustodyReceiptDocumentDto, type ItCustodyReceiptLineDto } from '@ecms/contracts';
import {
  buildCustodyReceiptHtml,
  DEVICES_STYLE,
  formDigits,
  kindGender,
  RECEIPT_UNDERTAKING,
  RECEIPT_UNDERTAKING_FEMININE,
  receiptDate,
  receiptNumberLabel,
  receiptSheet,
  signatureName,
  specGroups,
  specSummary,
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
  employeeName: 'وليد صفوت جلال صفوت',
  employeeCode: '0100026',
  jobTitle: { ar: 'محاسب', en: 'Accountant' },
  nationalId: '29801011234567',
  nationalIdVisible: true,
  section: { ar: 'التسويات', en: 'Settlements' },
  department: { ar: 'الإدارة المالية', en: 'Finance' },
  custodian: null,
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
    expect(html).toContain(
      '<title>إقرار استلام EGYCASH-IT-F-14-0007 — وليد صفوت جلال صفوت</title>',
    );
  });

  it('fills the statement in the form’s red with what the system knows', () => {
    expect(html).toContain(
      'أقر أنا / <span class="fill"><bdi>وليد صفوت جلال صفوت</bdi></span>',
    );
    expect(html).toContain('بوظيفة <span class="fill"><bdi>محاسب</bdi></span>');
    // «شيل كلمة لتكنولوجيا … وخليها للحلول النقدية على طول».
    expect(html).toContain('بشركة إيجي كاش للحلول النقدية،');
    expect(html).not.toContain('لتكنولوجيا');
    // The item by its kind — the category, «لاب توب» — and its make and model («خليه يظهر الـ
    // Manufacturer / Model بداله»), then its serial, then the table it introduces.
    expect(html).toContain(
      'بأنني قد استلمت <span class="kind">لاب توب</span> <span class="fill whole"><bdi>Dell / N4050</bdi></span>',
    );
    expect(html).toContain(
      'برقم مسلسل <span class="fill whole"><bdi>B600DN3</bdi></span> ومواصفاته كالتالي:',
    );
    expect(html).toMatch(/\.fill \{ color: #f00;/u);
    // A serial, an ID, a date or a device's kind is read whole; a name or a job title wraps like
    // the sentence around it, so a long one never stretches a gap across the line before it.
    expect(html).toContain('.fill.whole { white-space: nowrap; }');
    expect(html).toContain('بوظيفة <span class="fill"><bdi>محاسب</bdi>');
  });

  it('names the device by its make and model, in one piece', () => {
    // The owner's own example.
    const lenovo = { ...LAPTOP, manufacturer: 'Lenovo', model: 'ThinkCentre neo 50a 24 gen 5' };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [lenovo] }), LABELS));
    expect(page).toContain(
      'بأنني قد استلمت <span class="kind">لاب توب</span> <span class="fill whole"><bdi>Lenovo / ThinkCentre neo 50a 24 gen 5</bdi></span>',
    );
    // The kind is the form's word, in its ink; only the make and model are filled in red.
    expect(page).not.toContain('<bdi>لاب توب</bdi>');
    // The table still has its «Manufacturer / Model» row.
    expect(page).toContain(
      '<td>Manufacturer / Model</td><td>Lenovo / ThinkCentre neo 50a 24 gen 5</td>',
    );
  });

  it('sets the statement from the right edge — justifying would stretch a whole name’s line', () => {
    expect(html).toMatch(/\.statement \{[^}]*text-align: start;/u);
  });

  it('names the item by its kind and its own name when neither make nor model is on file', () => {
    const [page] = pages(
      buildCustodyReceiptHtml(
        paper({ lines: [{ ...LAPTOP, manufacturer: null, model: null }] }),
        LABELS,
      ),
    );
    expect(page).toContain(
      'بأنني قد استلمت <span class="kind">لاب توب</span> <span class="fill whole"><bdi>Dell Inspiron N4050</bdi></span>',
    );
  });

  // «عايز كلمة جهاز تبقى متغيرة بتاء على نوع ما يتم تسليمه · فلو شاشة يبقى شاشة ولو ماوس أو كيبورد
  // يتكتبوا ولو جهاز يبقي جهاز وهكذا حسب (الفئة)».
  it.each([
    [
      'شاشة',
      'Dell',
      'P2419H',
      'استلمت <span class="kind">شاشة</span> <span class="fill whole"><bdi>Dell / P2419H</bdi></span>',
    ],
    [
      'ماوس',
      'Logitech',
      'M185',
      'استلمت <span class="kind">ماوس</span> <span class="fill whole"><bdi>Logitech / M185</bdi></span>',
    ],
    [
      'كيبورد',
      'Logitech',
      'K120',
      'استلمت <span class="kind">كيبورد</span> <span class="fill whole"><bdi>Logitech / K120</bdi></span>',
    ],
    [
      'جهاز كمبيوتر',
      'HP',
      'ProDesk 400',
      'استلمت <span class="kind">جهاز كمبيوتر</span> <span class="fill whole"><bdi>HP / ProDesk 400</bdi></span>',
    ],
  ])('calls a «%s» what its category calls it, not «جهاز»', (kind, manufacturer, model, phrase) => {
    const line = { ...SCREEN, deviceType: kind, manufacturer, model };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [line] }), LABELS));
    expect(page).toContain(`بأنني قد ${phrase}`);
    if (kind !== 'جهاز كمبيوتر') expect(page).not.toContain('استلمت جهاز');
  });

  it('calls a computer «جهاز» — never «كمبيوتر All» again', () => {
    // «ولو جهاز يبقي جهاز», and «يظهر … جهاز كمبيوتر All لأ خليه يظهر الـ Manufacturer / Model».
    for (const category of ['كمبيوتر All', 'كمبيوتر مكتبي', 'كمبيوتر', 'Desktop', 'All in One']) {
      const aio = {
        ...LAPTOP,
        deviceType: category,
        manufacturer: 'Lenovo',
        model: 'ThinkCentre neo 50a 24 gen 5',
      };
      const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [aio] }), LABELS));
      expect(page, category).toContain(
        'بأنني قد استلمت <span class="kind">جهاز</span> <span class="fill whole"><bdi>Lenovo / ThinkCentre neo 50a 24 gen 5</bdi></span>',
      );
      expect(page, category).not.toContain(category === 'كمبيوتر' ? 'كمبيوتر <' : category);
    }
  });

  it('keeps the kind on one line — «لاب توب» is one word to a reader', () => {
    expect(html).toContain('.kind { white-space: nowrap; }');
  });

  it('does not say the kind twice when the asset’s name already starts with it', () => {
    // The inventory named a model-less desktop «كمبيوتر مكتبي HP»: a computer, so «جهاز HP».
    const desktop = {
      ...SCREEN,
      deviceType: 'كمبيوتر مكتبي',
      name: 'كمبيوتر مكتبي HP',
      manufacturer: null,
      model: null,
    };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [desktop] }), LABELS));
    expect(page).toContain(
      'استلمت <span class="kind">جهاز</span> <span class="fill whole"><bdi>HP</bdi></span>',
    );
    // …and a screen named «شاشة Dell» is «شاشة Dell», not «شاشة شاشة Dell».
    const screen = { ...SCREEN, name: 'شاشة  Dell 24' };
    const [second] = pages(buildCustodyReceiptHtml(paper({ lines: [screen] }), LABELS));
    expect(second).toContain(
      'استلمت <span class="kind">شاشة</span> <span class="fill whole"><bdi>Dell 24</bdi></span>',
    );
  });

  it('takes the kind off the name only as a whole word', () => {
    const screens = { ...SCREEN, deviceType: 'شاشة', name: 'شاشةDell 24' };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [screens] }), LABELS));
    expect(page).toContain(
      'استلمت <span class="kind">شاشة</span> <span class="fill whole"><bdi>شاشةDell 24</bdi></span>',
    );
  });

  it('fills the employee code right after the company — «عايز بردو أضيف كود الموظف هنا»', () => {
    // Whole, and in the form's digits, like the national ID after it.
    expect(html).toContain(
      'بشركة إيجي كاش للحلول النقدية، كود <span class="fill whole"><bdi>٠١٠٠٠٢٦</bdi></span>، بطاقة رقم قومي',
    );
  });

  it('fills the national ID from the system, straight into «بأنني قد استلمت»', () => {
    // «مفروض تملأها تلقائي من النظام … ورقمه القومي».
    expect(html).toContain(
      'بطاقة رقم قومي <span class="fill whole"><bdi>٢٩٨٠١٠١١٢٣٤٥٦٧</bdi></span> بأنني قد استلمت',
    );
  });

  it('prints no «صادرة من قسم … – … بتاريخ …» — the section, department and date are left out', () => {
    // «شيل الجزء دا من الإيصال»: even when HR has all three, none of them is on the paper.
    expect(html).not.toContain('صادرة من');
    expect(html).not.toContain('بتاريخ');
    expect(html).not.toContain('التسويات');
    expect(html).not.toContain('الإدارة المالية');
    // The paper's date is still there — in the signature block.
    expect(html).toContain('<div>التاريخ: ٣٠ / ٨ / ٢٠٢٣</div>');
  });

  it('leaves the national ID for the pen when the reader may not see it', () => {
    const withheld = buildCustodyReceiptHtml(
      paper({ nationalId: null, nationalIdVisible: false }),
      LABELS,
    );
    expect(withheld).toMatch(/بطاقة رقم قومي <span class="fill whole">\.{8,}<\/span> بأنني/u);
    expect(withheld).not.toContain('٢٩٨٠١٠١١٢٣٤٥٦٧');
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
    // Three parts under the signature — «ممكن ثلاثي فقط تحت عند الإمضاء» — the full name above.
    expect(html).toContain('<div>الاسم: وليد صفوت جلال</div>');
    expect(html).toContain(
      'أقر أنا / <span class="fill"><bdi>وليد صفوت جلال صفوت</bdi></span>',
    );
    expect(html).toContain('<div>التوقيع:</div>');
    expect(html).toContain('<div>التاريخ: ٣٠ / ٨ / ٢٠٢٣</div>');
    // In a right-to-left page the left half is reached by padding the RIGHT one.
    const rule = /^\s*\.signs \{([^}]*)\}/mu.exec(html)?.[1] ?? '';
    expect(rule).toContain('padding-right: 50%');
    // And a line of it is never broken in two.
    expect(html).toContain('.signs > div { white-space: nowrap; }');
  });

  it('numbers the paper in its footer, beside the department', () => {
    // «ابدأ بـ 0001 وكل طباعة زود رقم» — the paper's own number, padded to four digits.
    expect(html).toContain('<b>EGYCASH</b> | IT Dept. | EGYCASH-IT-F-14-0007</span>');
    // One page: no page count in the footer's block.
    expect(html).toContain('<span class="block"></span>');
  });

  it('prints several devices on ONE sheet, under the one number, with no page count', () => {
    // «عند تسليم أكثر من أصل يتم عمل إيصال لكل أصل على حدي أنا عايز يتطبعوا فى ورقه واحده».
    const two = buildCustodyReceiptHtml(paper({ lines: [LAPTOP, SCREEN] }), LABELS);
    expect(pages(two)).toHaveLength(1);
    expect(two).toContain('>B600DN3<');
    expect(two).toContain('>49WNRS3<');
    expect(two).toContain('EGYCASH-IT-F-14-0007</span>\n    <span class="block"></span>');
    expect(two).not.toMatch(/<span class="block">\d+\/\d+<\/span>/u);
  });

  it('a device with nothing on file prints no table and no accessories — the sentence ends there', () => {
    const [bare] = pages(buildCustodyReceiptHtml(paper({ lines: [SCREEN] }), LABELS));
    expect(bare).toContain('برقم مسلسل <span class="fill whole"><bdi>49WNRS3</bdi></span>.</p>');
    // A screen is «هي», so neither lead is checked by its masculine alone: in no gender at all.
    expect(bare).not.toContain('ومواصفات');
    expect(bare).not.toContain('<table');
    expect(bare).not.toContain('ومشتملات');
  });

  it('a receipt with no kind on file keeps the form’s «جهاز», then the asset’s own name', () => {
    const legacy = { ...SCREEN, deviceType: null };
    const [old] = pages(buildCustodyReceiptHtml(paper({ lines: [legacy] }), LABELS));
    expect(old).toContain(
      'استلمت <span class="kind">جهاز</span> <span class="fill whole"><bdi>Dell Screen</bdi></span>',
    );
  });

  it('a category already named «جهاز …» is said once, not «جهاز جهاز»', () => {
    const named = { ...SCREEN, deviceType: 'جهاز كمبيوتر مكتبي' };
    const [page] = pages(buildCustodyReceiptHtml(paper({ lines: [named] }), LABELS));
    expect(page).toContain(
      'استلمت <span class="kind">جهاز كمبيوتر مكتبي</span> <span class="fill whole"><bdi>Dell Screen</bdi></span>',
    );
    expect(page).not.toContain('جهاز جهاز');
  });

  it('leaves a line for the pen when the system cannot name the employee', () => {
    const blank = buildCustodyReceiptHtml(
      paper({ employeeName: null, jobTitle: null, employeeCode: null }),
      LABELS,
    );
    expect(blank).toMatch(
      /أقر أنا \/ <span class="fill">\.{10,}<\/span> بوظيفة <span class="fill">\.{10,}<\/span>/u,
    );
    expect(blank).toMatch(/، كود <span class="fill whole">\.{8,}<\/span>، بطاقة رقم قومي/u);
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

  it('writes a national ID digit for digit — nothing dropped, grouped or rounded', () => {
    expect(formDigits('29801011234567')).toBe('٢٩٨٠١٠١١٢٣٤٥٦٧');
    expect(formDigits('30001010000007')).toBe('٣٠٠٠١٠١٠٠٠٠٠٠٧');
  });

  it('shortens the signature name to three parts, compound parts whole', () => {
    expect(signatureName('كريم سامح فؤاد منير حمدي')).toBe('كريم سامح فؤاد');
    expect(signatureName('محمد عبد الله علي حسن')).toBe('محمد عبد الله علي');
    expect(signatureName(null)).toBe('');
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

// «شوف أنت الأنسب وأعمله»: asked whether the form's «ومواصفاته … لاستخدامه … عليه … برده» should
// agree with a feminine item such as a «شاشة», the owner left the choice to us. Each page agrees
// with its own item's kind, and a masculine page is the form word for word.
describe('the paper agrees with the item it hands over', () => {
  it.each(['شاشة', 'طابعة ليزر', 'سماعات', 'كاميرا', 'كاميرا مراقبة', 'شاشات', 'سماعة رأس'])(
    'a «%s» is «هي»',
    (kind) => {
      expect(kindGender(kind)).toBe('feminine');
    },
  );

  it.each(['جهاز', 'لاب توب', 'ماوس', 'كيبورد', 'هاتف IP', 'راوتر', 'جهاز كمبيوتر مكتبي', 'UPS'])(
    'a «%s» is «هو»',
    (kind) => {
      expect(kindGender(kind)).toBe('masculine');
    },
  );

  it('goes by the first word, the noun the rest describes', () => {
    // «كارت شاشة» is a card for a screen, so it is a card.
    expect(kindGender('كارت شاشة')).toBe('masculine');
    expect(kindGender('شاشة لمس')).toBe('feminine');
  });

  it('reads the same word however it is spaced, punctuated, marked or written with its hamza', () => {
    for (const kind of [
      '  شاشة  ',
      'طابعة   ليزر',
      'شاشة/Monitor',
      'شاشـة',
      'شاشةٌ',
      'كامـيرا',
      'آلة تصوير',
      'الة تصوير',
      'أداة',
      'اداة',
    ]) {
      expect(kindGender(kind), kind).toBe('feminine');
    }
    for (const kind of ['هاتف   IP', 'لاب  توب', ' ماوس ', 'إكسسوار', 'اكسسوار']) {
      expect(kindGender(kind), kind).toBe('masculine');
    }
  });

  it('counts a plural in «ات» only when it has a stem: «كات 6» is a cable, not a plural', () => {
    expect(kindGender('كات 6')).toBe('masculine');
  });

  it('counts only a written «ة», since a plain «ه» may as well end a masculine word', () => {
    // «موجه» is a router. «شاشه» typed that way keeps the form's masculine, as it always has.
    expect(kindGender('موجه')).toBe('masculine');
    expect(kindGender('شاشه')).toBe('masculine');
  });

  it('words the feminine undertaking as the form does, with only the item’s three pronouns changed', () => {
    expect(RECEIPT_UNDERTAKING_FEMININE).toBe(
      'وذلك لاستخدامها في إنهاء أعمال الشركة وأتعهد بالحفاظ عليها حفاظ الشخص الحريص على ماله الخاص وأتعهد بردها إلى الشركة متى طلب مني ذلك.',
    );
    const masculine = RECEIPT_UNDERTAKING.split(' ');
    const feminine = RECEIPT_UNDERTAKING_FEMININE.split(' ');
    expect(feminine).toHaveLength(masculine.length);
    expect(feminine.filter((word, i) => word !== masculine[i])).toEqual([
      'لاستخدامها',
      'عليها',
      'بردها',
    ]);
    // «على ماله الخاص» is the careful person's own property, not the item, so it keeps its «ـه».
    expect(RECEIPT_UNDERTAKING_FEMININE).toContain('على ماله الخاص');
  });

  it('a sheet of several devices speaks of them as «هي», whatever each one is', () => {
    const screen = { ...SCREEN, manufacturer: 'Dell', model: 'P2419H', accessories: ['كابل HDMI'] };
    const two = buildCustodyReceiptHtml(paper({ lines: [LAPTOP, screen] }), LABELS);
    // «الأجهزة الآتية» are a plural of things: the undertaking is the form's feminine, once.
    expect(two).toContain(`<p class="undertaking">${RECEIPT_UNDERTAKING_FEMININE}</p>`);
    expect(two).not.toContain(RECEIPT_UNDERTAKING);
    expect(two.match(/class="undertaking"/gu)).toHaveLength(1);
    // No device's own lead is left over from the one-device form.
    expect(two).not.toContain('ومواصفاته');
    expect(two).not.toContain('ومشتملات');
    // And it still carries no script of its own.
    expect(two).not.toMatch(/<script/iu);
    expect(two).not.toMatch(/\son[a-z]+=/iu);
  });

  it('changes those words and nothing else on the page', () => {
    const as = (deviceType: string): string =>
      buildCustodyReceiptHtml(paper({ lines: [{ ...LAPTOP, deviceType }] }), LABELS);
    expect(
      as('طابعة')
        .replace('<span class="kind">طابعة</span>', '<span class="kind">ماوس</span>')
        .replace('ومواصفاتها كالتالي:', 'ومواصفاته كالتالي:')
        .replace('ومشتملاتها كالتالي:', 'ومشتملاته كالتالي:')
        .replace(RECEIPT_UNDERTAKING_FEMININE, RECEIPT_UNDERTAKING),
    ).toBe(as('ماوس'));
  });

  it('keeps a computer and a receipt with no kind masculine, since both are «جهاز»', () => {
    for (const deviceType of ['كمبيوتر All', null]) {
      const [page] = pages(
        buildCustodyReceiptHtml(paper({ lines: [{ ...LAPTOP, deviceType }] }), LABELS),
      );
      expect(page, String(deviceType)).toContain(
        `<p class="undertaking">${RECEIPT_UNDERTAKING}</p>`,
      );
    }
  });

  it('closes in the form’s masculine when a paper names no gender, as the line paper’s «خط» does', () => {
    expect(receiptSheet({ paper: paper(), body: '', block: '' })).toContain(
      `<p class="undertaking">${RECEIPT_UNDERTAKING}</p>`,
    );
    expect(receiptSheet({ paper: paper(), body: '', block: '', gender: 'feminine' })).toContain(
      `<p class="undertaking">${RECEIPT_UNDERTAKING_FEMININE}</p>`,
    );
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

// 2026-11-19 — «في عهدة إدارة … بموقع …»: a DEPARTMENT CUSTODY paper, signed by the department's
// responsible person. Only the statement, the closing and the title change; the undertaking is the
// form's, word for word, and the number series is the same.
describe('a department custody paper', () => {
  const custodian = {
    departmentId: '000000000000000000000d01',
    departmentName: { ar: 'تقنية المعلومات', en: 'Information Technology' },
    locationId: '000000000000000000000f01',
    locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
  };
  const signer = {
    employeeName: 'شريف ممدوح فاروق',
    employeeCode: '0100077',
    jobTitle: { ar: 'مهندس شبكات', en: 'Network engineer' },
  };
  const html = buildCustodyReceiptHtml(paper({ ...signer, custodian }), LABELS);

  it('says the signer acknowledges FOR the department, and where the device is kept', () => {
    expect(html).toContain('أقر أنا / <span class="fill"><bdi>شريف ممدوح فاروق</bdi></span>');
    expect(html).toContain(
      '، بصفتي المسؤول عن إدارة <span class="fill"><bdi>تقنية المعلومات</bdi></span> بأنني قد استلمت',
    );
    expect(html).toContain(
      'برقم مسلسل <span class="fill whole"><bdi>B600DN3</bdi></span> ليكون في عهدة إدارة <span class="fill"><bdi>تقنية المعلومات</bdi></span> بموقع <span class="fill"><bdi>غرفة السيرفرات</bdi></span> ومواصفاته كالتالي:',
    );
  });

  it('keeps the undertaking word for word, and signs «عن إدارة» under the name', () => {
    expect(html).toContain(`<p class="undertaking">${RECEIPT_UNDERTAKING}</p>`);
    expect(html).toContain('<div>الاسم: شريف ممدوح فاروق</div>');
    expect(html).toContain('<div>عن إدارة: تقنية المعلومات</div>');
  });

  it('is titled by the department, under the same F-14 number', () => {
    expect(html).toContain(
      '<title>إقرار استلام EGYCASH-IT-F-14-0007 — إدارة تقنية المعلومات</title>',
    );
  });

  it('writes HR’s «إدارة …» once, never «إدارة إدارة …»', () => {
    const named = buildCustodyReceiptHtml(
      paper({
        custodian: { ...custodian, departmentName: { ar: 'إدارة الخزينة', en: 'Treasury' } },
      }),
      LABELS,
    );
    expect(named).toContain('عهدة إدارة <span class="fill"><bdi>الخزينة</bdi></span>');
    expect(named).not.toContain('إدارة إدارة');
  });

  it('leaves the pen a line where the department or the place could not be named', () => {
    const unnamed = buildCustodyReceiptHtml(
      paper({ custodian: { ...custodian, departmentName: null, locationName: null } }),
      LABELS,
    );
    expect(unnamed).toContain('بموقع <span class="fill">....................</span>');
  });

  it('an employee’s paper says none of it', () => {
    const own = buildCustodyReceiptHtml(paper(), LABELS);
    expect(own).not.toContain('بصفتي المسؤول');
    expect(own).not.toContain('ليكون في عهدة');
    expect(own).not.toContain('عن إدارة');
  });
});

// 2026-11-24 — «عند تسليم أكثر من أصل يتم عمل إيصال لكل أصل على حدي أنا عايز يتطبعوا فى ورقه
// واحده». A paper of several devices is ONE sheet: one statement, a table with a row per device,
// one undertaking and one signature — the layout the owner approved from a sample. A paper of one
// device is the form above, unchanged.
describe('a paper of several devices, on one sheet', () => {
  const MOUSE: ItCustodyReceiptLineDto = {
    ...SCREEN,
    assetId: '000000000000000000000003',
    assetCode: 'AST-00003',
    name: 'Logitech M185',
    serialNumber: '2135LZ0A1B8',
    deviceType: 'ماوس',
    manufacturer: 'Logitech',
    model: 'M185',
  };
  const html = buildCustodyReceiptHtml(paper({ lines: [LAPTOP, SCREEN, MOUSE] }), LABELS);
  const rows = (doc: string): string[] =>
    (/<tbody>(.*)<\/tbody>/su.exec(doc.split('<table class="devices">')[1] ?? '')?.[1] ?? '')
      .split('<tr>')
      .slice(1);

  it('says the statement once, naming how many devices it received', () => {
    expect(pages(html)).toHaveLength(1);
    expect(html.match(/<p class="statement">/gu)).toHaveLength(1);
    expect(html).toContain('أقر أنا / <span class="fill"><bdi>وليد صفوت جلال صفوت</bdi></span>');
    expect(html).toContain(
      'بأنني قد استلمت الأجهزة الآتية وعددها (<span class="fill">٣</span>) وبياناتها كالتالي:</p>',
    );
    // No device is received one by one: no «برقم مسلسل», no per-device specifications table.
    expect(html).not.toContain('برقم مسلسل');
    expect(html).not.toContain('<table class="specs"');
  });

  it('lists every device in one table, a row each, in the order handed over', () => {
    expect(html).toContain(
      '<tr><th>م</th><th>الجهاز</th><th>الماركة / الموديل</th><th>الرقم المسلسل</th><th>المواصفات</th><th>المشتملات</th></tr></thead>',
    );
    const [laptop = '', screen = '', mouse = ''] = rows(html);
    expect(rows(html)).toHaveLength(3);
    expect(laptop).toContain(
      '<td class="n">١</td><td>لاب توب</td><td class="en"><bdi>Dell / N4050</bdi></td>',
    );
    expect(laptop).toContain('<td class="en serial">B600DN3</td>');
    expect(laptop).toContain(
      '<div><b>CPU:</b> Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache</div><div><b>RAM:</b> 4.00 GB RAM</div>',
    );
    expect(laptop.match(/<b>Network:<\/b>/gu)).toHaveLength(2);
    expect(laptop).toContain('<td>شاحن لاب توب</td></tr>');
    // A screen with no make or model on file is named by its own name, its kind not said twice.
    expect(screen).toContain(
      '<td class="n">٢</td><td>شاشة</td><td class="en"><bdi>Dell Screen</bdi></td>',
    );
    // No specifications or accessories: the cell says so rather than standing empty.
    expect(screen).toContain('<td class="en spec">—</td><td>—</td></tr>');
    expect(mouse).toContain(
      '<td class="n">٣</td><td>ماوس</td><td class="en"><bdi>Logitech / M185</bdi></td>',
    );
  });

  it('closes once: one undertaking, in the plural’s «ها», and one signature', () => {
    expect(html.match(/class="undertaking"/gu)).toHaveLength(1);
    expect(html).toContain(`<p class="undertaking">${RECEIPT_UNDERTAKING_FEMININE}</p>`);
    expect(html.match(/<div>التوقيع:<\/div>/gu)).toHaveLength(1);
    expect(html).toContain('<div>الاسم: وليد صفوت جلال</div>');
    expect(html).toContain('<div>التاريخ: ٣٠ / ٨ / ٢٠٢٣</div>');
  });

  it('carries the table’s rules — a row never split across two pages, a serial kept in its cell', () => {
    expect(html).toContain(DEVICES_STYLE);
    expect(DEVICES_STYLE).toContain('.devices tr { break-inside: avoid; }');
    // A serial too long for its column breaks inside its own cell rather than printing over the
    // make and model beside it: nothing keeps it on one line. The only cell kept on one line is
    // the row's number, and every cell may break a word that does not fit.
    expect(DEVICES_STYLE.match(/nowrap/gu)).toEqual(['nowrap']);
    expect(DEVICES_STYLE).toContain('.devices td.n { text-align: center; white-space: nowrap; }');
    expect(DEVICES_STYLE.match(/overflow-wrap: [a-z-]+/gu)).toEqual(['overflow-wrap: anywhere']);
    // A list that runs onto a second page takes the closing over whole — the undertaking never
    // split, the signature unsplit — and the list's last row with it, so the signed page lists a
    // device.
    expect(DEVICES_STYLE).toContain('.undertaking { break-before: avoid; break-inside: avoid; }');
    expect(DEVICES_STYLE).toContain('.undertaking, .oath { break-after: avoid; }');
    expect(DEVICES_STYLE).toContain('.signs { break-inside: avoid; }');
    // A paper of one device is the form, and carries none of it.
    expect(buildCustodyReceiptHtml(paper(), LABELS)).not.toContain('.devices');
  });

  it('heads the table with the paper’s number, so every page of a long list names it', () => {
    // A table's head is repeated on every page it runs onto; the footer is on the last page only.
    expect(html).toContain(
      '<thead><tr class="ref"><th colspan="6">EGYCASH-IT-F-14-0007</th></tr><tr><th>م</th>',
    );
    // A receipt from before numbering heads it with the form's bare prefix, as its footer does.
    const unnumbered = buildCustodyReceiptHtml(
      paper({ formNumber: null, lines: [LAPTOP, SCREEN] }),
      LABELS,
    );
    expect(unnumbered).toContain('<tr class="ref"><th colspan="6">EGYCASH-IT-F-14</th></tr>');
  });

  it('keeps an Arabic name in its own order inside the left-to-right make-and-model cell', () => {
    // No make or model on file: the cell holds the asset's own name, isolated like the statement's.
    const printer = { ...SCREEN, name: 'طابعة HP ليزر', deviceType: 'طابعات' };
    const [row = ''] = rows(buildCustodyReceiptHtml(paper({ lines: [printer, SCREEN] }), LABELS));
    expect(row).toContain('<td class="en"><bdi>طابعة HP ليزر</bdi></td>');
  });

  it('calls a computer «جهاز» in its row, as the form does', () => {
    const aio = {
      ...LAPTOP,
      deviceType: 'كمبيوتر All in One',
      manufacturer: 'Lenovo',
      model: 'neo 50a',
    };
    const [row = ''] = rows(buildCustodyReceiptHtml(paper({ lines: [aio, SCREEN] }), LABELS));
    expect(row).toContain('<td>جهاز</td><td class="en"><bdi>Lenovo / neo 50a</bdi></td>');
  });

  it('escapes what people typed, in every cell', () => {
    const typed = buildCustodyReceiptHtml(
      paper({
        lines: [
          {
            ...LAPTOP,
            deviceType: '<u>',
            accessories: ['<img src=x>'],
            model: '<em>',
            serialNumber: '<i>',
            specs: LAPTOP.specs === null ? null : { ...LAPTOP.specs, processor: '<s>' },
          },
          { ...SCREEN, name: '<q>' },
        ],
      }),
      LABELS,
    );
    for (const raw of ['<img src=x>', '<u>', '<em>', '<i>', '<s>', '<q>']) {
      expect(typed).not.toContain(raw);
    }
    expect(typed).toContain('<td>&lt;u&gt;</td>');
    expect(typed).toContain('&lt;img src=x&gt;');
    expect(typed).toContain('<bdi>Dell / &lt;em&gt;</bdi>');
    expect(typed).toContain('<td class="en serial">&lt;i&gt;</td>');
    expect(typed).toContain('<b>CPU:</b> &lt;s&gt;</div>');
    expect(typed).toContain('<bdi>&lt;q&gt;</bdi>');
  });

  it('a department’s sheet: signed FOR the department, the devices kept at its place', () => {
    const custodian = {
      departmentId: '000000000000000000000d01',
      departmentName: { ar: 'تقنية المعلومات', en: 'Information Technology' },
      locationId: '000000000000000000000f01',
      locationName: { ar: 'غرفة السيرفرات', en: 'Server room' },
    };
    const dept = buildCustodyReceiptHtml(
      paper({ employeeName: 'شريف ممدوح فاروق', custodian, lines: [LAPTOP, SCREEN] }),
      LABELS,
    );
    expect(dept).toContain(
      '، بصفتي المسؤول عن إدارة <span class="fill"><bdi>تقنية المعلومات</bdi></span> بأنني قد استلمت الأجهزة الآتية وعددها (<span class="fill">٢</span>) لتكون في عهدة إدارة <span class="fill"><bdi>تقنية المعلومات</bdi></span> بموقع <span class="fill"><bdi>غرفة السيرفرات</bdi></span> وبياناتها كالتالي:</p>',
    );
    expect(dept).not.toContain('ليكون في عهدة');
    expect(dept).toContain('<div>عن إدارة: تقنية المعلومات</div>');
    expect(dept).toContain(
      '<title>إقرار استلام EGYCASH-IT-F-14-0007 — إدارة تقنية المعلومات</title>',
    );
  });

  it('keeps a long hand-over on one sheet’s flow, every device a row, under one number', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...SCREEN,
      assetId: String(i + 1).padStart(24, '0'),
      serialNumber: `SN${String(i + 1)}`,
    }));
    const long = buildCustodyReceiptHtml(paper({ lines: many }), LABELS);
    expect(pages(long)).toHaveLength(1);
    expect(rows(long)).toHaveLength(20);
    expect(long).toContain('وعددها (<span class="fill">٢٠</span>)');
  });
});

describe('a device’s specifications in short (specSummary)', () => {
  it('lists every row with something to say, in the form’s order, under its short name', () => {
    expect(specSummary(LAPTOP)).toEqual([
      { label: 'CPU', value: 'Intel® Core™ i3-2330M CPU @ 2.10GHZ 3MB Cache' },
      { label: 'RAM', value: '4.00 GB RAM' },
      { label: 'System', value: '64-bit Operating System' },
      { label: 'Storage', value: '500 GB' },
      { label: 'Media', value: 'CD/DVD RW' },
      { label: 'Graphics', value: 'Intel® HD Graphic 3000 Family' },
      { label: 'VRAM', value: '1 GB' },
      { label: 'Network', value: 'Dell Wireless 1701 802.11 b/g/n' },
      { label: 'Network', value: 'Realtec PCIe FE Family Controller' },
    ]);
  });

  it('leaves out its make and model, and anything blank', () => {
    const sparse = {
      ...LAPTOP,
      specs: {
        processor: '  ',
        memory: '8 GB',
        systemType: null,
        storage: null,
        mediaDrive: null,
        displayAdapter: null,
        graphicsMemory: null,
        networkAdapters: [' '],
      },
    };
    expect(specSummary(sparse)).toEqual([{ label: 'RAM', value: '8 GB' }]);
    expect(specSummary(SCREEN)).toEqual([]);
  });
});
