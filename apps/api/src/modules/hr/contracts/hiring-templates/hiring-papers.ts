// The owner's fourteen hiring papers — «مستندات التعيين» — as templates (A27, stage 2).
//
// «بص هبعتلك الفايلات و قولي تتعمل ازاي»: the contract, the data sheet, the work-receipt, relatives
// and weapon declarations, the bank letter, and the seven job description cards, copied from his
// Word files. The words are his, as he prints them today. That is why this file is in
// `VERBATIM_PAPERS` (scripts/check-formal-arabic.mjs): a record of his documents, not prose of ours.
//
// The forms are his BLANK papers («رجعهم كلهم زي الاصل»): his spelling, sizes and layout, a dotted
// line where the employee writes by hand. Only the bank letter (with the contract) is filled: where
// it leaves a line for the employee's own facts the line is a `{{placeholder}}`, and a fact the
// record lacks prints as a dotted line. His sample bank letter carried one employee's facts; none of
// them is here. The contract is filled the same way, in his type and layout and with his spelling.
//
// These are only the STARTING papers. `syncHiringTemplates` writes each one once; HR edits them
// in «قوالب العقود» like any template, and an edit is never overwritten. A paper's `revision`
// rewrites the row the boot wrote, while nobody has touched it.
import { type ContractTemplateKind, type LocalizedString, type SignatureBlock } from '@ecms/contracts';
import { CIT_SPECIALISTS, WEAPON_HOLDERS, matchesJob, type JobMatch, type JobNames } from '../../shared/job-match';

/** The jobs a paper prints for, by name — job titles carry no other link to a paper. */
export type PaperJobs = JobMatch;

export interface HiringPaper {
  /** Stable identity — the template key. Never change one: it is how a paper is recognized. */
  key: string;
  name: LocalizedString;
  kind: ContractTemplateKind;
  jobs: PaperJobs;
  /**
   * Jobs among `jobs` the paper is OFFERED to but not ticked for: the print pages list it unticked,
   * for HR to tick when it applies (the cash-in-transit specialist's weapon declaration).
   */
  optionalFor?: JobNames;
  printOrder: number;
  /**
   * The paper's own version. A row the boot wrote, and no person has touched since, is rewritten to
   * a newer revision on the next boot (`syncHiringTemplates`); missing means 1.
   */
  revision?: number;
  sections: { header: string; body: string; footer: string };
  signatures: SignatureBlock[];
}


// ── As his Word files print them: the forms are BLANK, written on by hand ─────────────────────
//
// «نموزج 1 و العقد و خطاب البنك هما الوحيدين اللي هيتملو … و الباقي لازم يكون فاضي الموظف هو اللي
// يكتب بياناته فيه و يمضي»; «رجعهم كلهم زي الاصل». Every form but the bank letter carries no
// placeholder: it prints as his blank paper — his words and spelling, his type sizes and line
// spacing, a dotted line where the employee writes, his document-control line at the foot of the
// page. The layout classes are the few the sanitizer allows (`PAPER_CLASSES`).

/** Spaces that hold their width — his papers leave room with them. */
const gap = (count: number): string => '&nbsp;'.repeat(count);
/** His title: bold, underlined, centered. */
const heading = (text: string, size: 't12' | 't14' | 't16'): string =>
  `<h3 class="${size}" style="text-align: center"><u>${text}</u></h3>`;
/**
 * One line of labels and dotted lines to write on: a string is printed as it is, `null` is the
 * dotted line, taking the room the labels leave.
 */
const line = (cells: readonly (string | null)[], cls = ''): string =>
  `<table class="plain${cls === '' ? '' : ` ${cls}`}"><tbody><tr>${cells
    .map((cell) => (cell === null ? '<td class="dots"></td>' : `<td>${cell}</td>`))
    .join('')}</tr></tbody></table>`;
/** His shaded heading box. */
const shaded = (text: string): string => `<table class="band"><tbody><tr><td>${text}</td></tr></tbody></table>`;
/** Two labels on one line, one at each end — where his paper spaces them apart (signatures). */
const apart = (start: string, end: string, cls = ''): string =>
  `<table class="plain${cls === '' ? '' : ` ${cls}`}"><tbody><tr><td>${gap(6)}${start}</td><td style="text-align: left">${end}${gap(6)}</td></tr></tbody></table>`;
/** His document-control line, at the foot of the page. */
const docControl = (code: string): string =>
  `<table class="foot"><tbody><tr><td>${code}</td><td>Issue / Rev. no.: 1/0</td><td>Issue date: 1/5/2022</td></tr></tbody></table>`;
/** «   /        /   202» — a date written by hand. */
const handDate = (year: string): string => `${gap(4)}/${gap(8)}/${gap(4)}${year}`;

// ── The contract ─────────────────────────────────────────────────────────────────────────────

/**
 * His contract's type (A27, «رجعهم كلهم زي الاصل»): bold 14pt at near-single spacing — his Word
 * file's Normal style — clauses under starred bullets, the obligations numbered.
 */
const CONTRACT_TYPE = 't14 l1';
const cpara = (text: string, align?: 'center' | 'left' | 'justify'): string =>
  `<p class="${CONTRACT_TYPE}"${align === undefined ? '' : ` style="text-align: ${align}"`}><b>${text}</b></p>`;
const cclause = (text: string, size = 't14'): string =>
  `<p class="${size} l1" style="text-align: center"><b><u>${text}</u></b></p>`;
const stars = (items: readonly string[]): string =>
  `<ul class="${CONTRACT_TYPE} star">${items.map((item) => `<li><b>${item}</b></li>`).join('')}</ul>`;
const cnumbered = (items: readonly string[]): string =>
  `<ol class="${CONTRACT_TYPE}">${items.map((item) => `<li><b>${item}</b></li>`).join('')}</ol>`;

const CONTRACT_BODY = [
  cpara('إنه في يوم {{contract.currentDayName}} الموافق {{contract.currentDate}}م.', 'justify'),
  cpara('<u>حرر بين كل من</u>:-'),
  cpara('<u>أولاً</u>:- السادة/ شركة إيجى كاش للحلول النقدية (ش.م.م) - الكائن مقرها بمقر البنك المركزي – ميدان سفنكس – العجوزة – الجيزة، ويمثلها قانوناً السيد الأستاذ اللواء/ رئيس مجلس الإدارة وينوب عنه في التوقيع على هذا العقد السيد اللواء/ جمال أحمد ابو إسماعيل بصفته المدير العام للشركة.', 'justify'),
  cpara('(طرف أول يشار إليه بلفظ رب العمل)', 'left'),
  cpara('<u>ثانياً</u>:- السيد/ {{employee.fullName}} المقيم في {{employee.address}} ويحمل رقم قومي {{employee.nationalId}}', 'justify'),
  cpara('(طرف ثاني يشار إليه بلفظ العامل)', 'left'),
  cclause('تمهيد', 't16'),
  stars([
    'حيث أن الطرف الأول هو شركة متخصصة في نقل الأموال وتغذية ماكينات الصراف الآلي في إطار القانون رقم 86 لسنة 2015م.',
    'وحيث ان الشركة وهى في مجال استيفاء احتياجاتها من العمالة ترغب في ان يعمل الطرف الثاني لديها بوظيفة ( {{job.title}} ) بحسب ما أبداه الطرف الثاني من صلاحيته لشغل الوظيفة وفي ضوء ما قدمه من مستندات تدل على هذه الصلاحية .',
    '<u>وبعد ان اقر الطرفان بأهليتهما وصلاحيتهما للتعاقد والتصرف قررا انهما اتفقا على الاتي</u> :',
  ]),
  cclause('البند الأول'),
  stars(['يعتبر التمهيد المتقدم جزء لا يتجزأ من هذا العقد ومكملا ومتمما لكل أركانه وكذا اللائحة الداخلية للشركة.']),
  cclause('البند الثاني'),
  stars([
    'موضوع هذا العقد هو عمل الطرف الثاني في وظيفة ( {{job.title}} ) لدى الطرف الأول ويؤهله لذلك ما قدمه من مؤهلات دراسية أو شهادات خبرة ويكون مسئولاً عن صحتها وسلامة ما تتضمنه من بيانات.',
    'واتفق الطرفان على أنه يحق للشركة أن تعهد إلى الموظف بأي عمل آخر يتفق مع طبيعة مؤهلاته أو يصبح مؤهلاً لأدائه بما اكتسبه من خبرة وتدريب خلال عمله بالشركة دون الحاجة إلى الحصول على موافقة الموظف وأنه يقبل أن يعمل في أي جهة تحتاج الشركة إلى خدماته فيها داخل جمهورية مصر العربية سواء بصفة مؤقتة أو دائمة وفي الوظائف التي تحددها بنفس مرتبه ودرجته المتفق عليها في هذا العقد مع مراعاة اللوائح التنظيمية للشركة وعدم المساس بحقوقه المقررة بهذا العقد أو بمقتضى القانون والذي يقر بعلمه بطبيعة عمل الشركة ونشاطها في نقل الأموال وما يمثله ذلك من خطورة وحساسية هذا النشاط وتعلقه بالأمن القومي وأنه يقر بمسئوليته الكاملة عن أية أضرار محققة أو محتملة الحدوث تكون نتيجة خطأ في تنفيذ مهام وظيفته أياً كان هذا الخطأ ويقر بتحمله جميع الأضرار المادية المالية الناتجة عن ذلك الخطأ تجاه الشركة أو تجاه الغير فضلاً عن تحمله المسئولية الجنائية كاملة عن هذا الخطأ والتقصير.',
  ]),
  cclause('البند الثالث'),
  stars([
    'مدة هذا العقد هي عام واحد تبدأ من {{contract.startDate}} وتنتهي في {{contract.endDate}} قابلة للتجديد بناء على طلب الطرف الأول ويعتبر العقد مجددا لمدة مماثلة ما لم يبد الطرف الأول رغبته في انهاء التعاقد قبل انتهاء مدته بشهر على الأقل.',
  ]),
  cclause('البند الرابع'),
  stars(['اتفق الطرفان على أن اجر الطرف الثاني الشهري الشامل على النحو التالي :']),
  // His salary lines: the amounts under one another, a line drawn under them, then the total.
  `<table class="plain ${CONTRACT_TYPE}"><tbody>` +
    '<tr><td><b>الاجر الاساسي</b></td><td>{{salary.fixed}} جنيها</td></tr>' +
    '<tr><td><b>بـــدل انـتـظــام</b></td><td>{{salary.attendanceBonus}} جنيها</td></tr>' +
    '<tr><td></td><td><b>ــــــــــــــــــــ</b></td></tr>' +
    '<tr><td><b>اجمالي الـراتب</b></td><td><b>{{salary.gross}}  ( فقط {{salary.grossInWords}} )</b></td></tr>' +
    '</tbody></table>',
  cpara('ويقبل الموظف بأن راتبه الذي يتقاضاه بموجب هذا العقد يمثل كافة مستحقاته لدى الشركة وكنتيجة لعلاقة عمله وتستقطع الشركة من المرتب الشامل المشار إليه كافة المبالغ التي يقضي القانون بخصمها كالضرائب واشتراك التأمينات الاجتماعية وغير ذلك من المبالغ التي يجب اقتطاعها طبقاً للقانون ويؤدى المرتب في أخر يوم من كل شهر أو في أقرب يوم عمل سابق له إذا وافق أخر الشهر عطلة رسمية أو راحة أسبوعية.', 'justify'),
  cclause('البند الخامس'),
  stars(['<u>التزامات الطرف الثاني</u> :']),
  cnumbered([
    'يجب على العامل القيام بالعمل المنوط بكل دقة وأمانة مراعيا في ذلك بذل عناية الرجل الحريص وحسب الأصول الفنية والعلمية المعروفة وفي المواعيد المقررة للعمل .',
    'تنفيذ أوامر الطرف الأول وتنفيذ التعليمات الصادرة إليه من رؤسائه وحسن معاملة مرؤوسيه.',
    'حسن معاملة العملاء والمحافظة على أسرار العمل.',
    'يحظر على الطرف الثاني الاقتراض من العملاء أو تلقى الهدايا منهم تحت أي مسمى طوال مدة هذا العقد .',
    'يلتزم الموظف (إذا ما رغب في إنهاء العقد بطريق الاستقالة) أن يخطر الشركة بهذه الرغبة كتابة قبل ثلاثون يوماً على الأقل من تاريخ ترك العمل.',
  ]),
  stars([
    'ويحظر على العامل إفشاء أسرار العمل ولا أسرار العملاء التي يطلع عليها بحكم عمله إلى الغير ولو بعد تركه للعمل لأي سبب من الأسباب وإلا كان مسئولا عن ذلك مسئولية كاملة.',
  ]),
  cclause('البند السادس'),
  stars([
    'لا يجوز للعامل العمل لدى أي جهة أخرى حكومية كانت أو أهلية ولا في وقت الفراغ دون الحصول على موافقة كتابية من رب العمل كما لا يجوز له القيام بأعمال منافسة بأجر ولا بغير اجر لصالح الغير .',
  ]),
  cclause('البند السابع'),
  stars([
    'يقر الطرف الثاني بصحة كافة البيانات والمستندات المقدمة منه عند التحاقه بالعمل – كما يلتزم بإخطار الطرف الأول كتابة بأي تغيير يطرأ على هذه البيانات فورا طوال مدة هذا العقد .',
  ]),
  cclause('البند الثامن'),
  stars([
    'يقر الطرف الثانى "الموظف" بالتزامه باخطار الطرف الاول "الشركة" فى حال رغبته فى ترك العمل عند انتهاء العقد بشهرين وفى حال مخالفه ذلك يلتزم بغرامة مالية قدرها تعادل اجر شهرين من اخر اجر تقاضاه فى حالة عدم الاخطار او تركه للعمل قبل انتهاء مدة العقد.',
    'كما يقر الطرف الثانى ايضا بالتزامه بسداد اى نفقات تحملتها الشركة فى اى دورة او تدريب سواء داخلية او خارجية استفاد منها طول فترة عمله هذا بالإضافة للغرامة المشار اليها فى الفقرة الاولى من البند فى حال تركه للعمل قبل انتهاء مدة العقد ، على انه اذا كان هذا التدريب او الدورات التدريبية خارج البلاد وتحملت الشركة نفقات هذا التدريب او الدورة فان الطرف الثانى يلتزم عند عودته بالاستمرار فى التعاقد والعمل مع الشركة لدمة لا تقل عن خمس سنوات والا فيلتزن بكافة النفقات التى تحملتها الشركة فضلا عن التعويض الذى لا يقل عن اجر ستة اشهر من اخر اجر تقاضاه الطرف الثانى.',
    'علما بان هذه الغرامة المقرره بهذا البند اتفاقيه لا رقابة للقضاء عليها ويلتزم بها الطرف الثانى ، كما يلتزم بأن ينفذ بدقة اللوائح الخاصة بالشركة وتعليماتها والحفاظ على حسن السير و السلوك السمعة.',
  ]),
  cclause('البند التاسع'),
  stars([
    'يظل العامل تحت الاختبار لمدة ثلاثة أشهر من تاريخ التعاقد يتقرر بعدها صلاحيته للعمل من عدمه بحسب رأى رب العمل بغير تعقيب ولا حق للعامل في الاعتراض على ذلك نهائيا ولا طلب التعويض عن إنهاء خدمته لعدم الصلاحية خلال فترة الاختبار .',
    'يستحق العامل أجازة سنوية بعد انتهاء مدة الاختبار المنصوص عليها تبعا لما ينص عليه قانون العمل الساري ولوائح الشركة.',
  ]),
  cclause('البند العاشر'),
  stars(['<u>يتم إنهاء خدمة العامل بشكل نهائي بغير حق له في أي تعويض في الحالات الآتية</u>:-']),
  cnumbered([
    'ثبوت عدم صحة المستندات المقدمة من العامل عند الالتحاق بالعمل .',
    'إساءة المعاملة من قبل العامل لعملاء الشركة أو التعدي عليهم أو على أي من العاملين بالشركة لأي سبب من الأسباب أو إتلاف عمدي أو إتلاف جسيم غير عمدي بممتلكات الشركة .',
    'ثبوت ارتكاب العامل لأي جريمة مخلة بالشرف والاعتبار والأمانة.',
    'التغيب عن العمل دون أسباب سائغة يقبلها رب العمل لمدة عشرة أيام متتالية أو عشرون يوما منقطعة خلال العام .',
    'التسبب في أضرار جسيمة للشركة يتعذر تداركها (ومن ثم اى فعل من شأنه خسارة الشركة لعملائها نتيجة سوء معاملة الطرف الثاني له او افتقاده المسلك اللائق) .',
    'عدم اظهار الكفاءة الفنية اللازمة لاداء العمل على الوجه اللائق .',
    'ارتكاب العامل اى مخالفه ماليه او اتهامه بارتكابه لاى مخالفه تخص نشاط الشركة .',
    'إذا ثبت ارتكابه للمخالفات الواردة على سبيل الحصر بالمادة (148) من قانون العمل رقم 14 لسنة 2025 وتعديلاته.',
  ]),
  cclause('البند الحادي عشر'),
  stars([
    'تؤول جميع الاختراعات التى يبتكرها العامل اثناء عمله الى رب العمل مقابل تعويض عادل يؤدى اليه رب العمل متى كانت هذه الاختراعات ذات صلة بالعمل .',
    'كما لا يجوز للعامل المطالبة باية مقابل كأجر من الحقوق الادبية لما يؤديه من اعمال لصالح رب العمل .',
  ]),
  cclause('البند الثاني عشر'),
  stars([
    'يلتزم الطرف الثاني بأداء العمل المطلوب منه بنفسه وفقاً للقواعد التي يحددها الطرف الأول وذلك تحت إشراف وإدارة الطرف الأول سواء فنيا أو إداريا من خلال المستويات الإدارية والإشرافية المتدرجة طبقاً لنظام العمل المتبع لدي الطرف الأول، كما يلتزم الطرف الثاني بإتباع كافة أحكام اللوائح والقوانين السارية والمطبقة علي العاملين لدي الطرف الأول ويقر بموجب توقيعه علي هذا العقد باطلاعه علي تلك اللوائح وقبول خضوعه لها وموافقته علي ما يطرأ عليها من تجديدات وتعديلات تهدف لصالح العمل.',
  ]),
  cclause('البند الثالث عشر'),
  stars([
    'يقر الطرف الثاني بعمله وإدراكه التام بمخاطر وأهمية العمل الذى أسنده إليه الطرف الأول وبإلمامه بطرق الوقاية الواجب عليه إتباعها لتلافي تحقق أية مخاطر أو أضرار، وبمسئوليته عن تعويض أية اضرار تلحق بأموال وممتلكات الطرف الأول سواء بتعريضها للفقد أو التلف أو التدمير أو التعطيل وخلافه ويقر بتحمله بقيمة هذه الأضرار خصما من أية مستحقات له لدي الطرف الأول، كما يقر بالتزامه ببذل كل عناية واجبة في أداء عمله وفقا لمعيار عناية الرجل الحريص في ماله الخاص كما يلتزم بإتباع كافة أحكام الوظيفة من طاعة للرؤساء واستجابة لما يصدر من تعليمات عمل مشروعة والمحافظة علي سرية المعلومات والبيانات التي تتاح له بمناسبة قيامه بأداء عمله، وأنه في المجمل ملتزم بعدم الخروج علي مقتضيات الوظيفة أو التزامات عمله الجوهرية وإلا أصبحت علاقة العمل التي تربطه بالطرف الأول واجبة الإنهاء فورا دون حاجة إلي اخطار أو تنبيه.',
  ]),
  cclause('البند الرابع عشر'),
  stars([
    'يقر الطرف الثاني بقبوله اجراء التعديلات التلقائية على هذا العقد كلما اقتضت القوانين السارية ذلك بمقتضى قواعد آمرة تقررها دون ان يحق له المطالبة بفسخ العقد لهذا السبب او انهائه .',
  ]),
  cclause('البند الخامس عشر'),
  stars([
    'اتفق الطرفان علي أن تنظيم حقوق الطرف الثاني لدي الطرف الأول من اجازات أو أداء حصص التأمينات الاجتماعية أو علاج وخلافه يحكمها اللوائح والقواعد المطبقة لدي الطرف الأول وما يطرأ عليها من تعديلات مستقبلا وتكملها أحكام قوانين العمل والقانون المدني وأية تشريعات أخرى يمكن أن تكمل أو تفسر أحكام تلك اللوائح والقواعد.',
    'ويقر الطرف الثاني علي قبوله الخصم من مرتبه للضرائب أو المستحقات الحكومية أو كلما كان هذا الخصم ناشئا عن القوانين السارية أو بموجب أمر صادر من جهات قضائية.',
  ]),
  cclause('البند السادس عشر'),
  stars([
    'يقر الطرفان بان موطن كل منها الموضح بصدر هذا العقد هو موطنه القانوني بحيث يكون أي انذار او اخطار او طلب يوجه من احدهما للاخر على هذا الموطن صحيحا ومنتجا لكافة اثاره القانونية .',
  ]),
  cclause('البند السابع عشر'),
  stars(['اى نزاع ينشأ من هذا العقد تختص محكمة المقر الرئيسي للشركة بنظره .']),
  cclause('البند الثامن عشر'),
  stars([
    'بما ذكر حرر هذا العقد من اربع نسخ بيد كل طرف نسخة للعمل بموجبها والنسخة الثالثة تودع بمكتب العمل المختص ونسة للتأمينات الإجتماعية.',
  ]),
  `<table class="plain cols ${CONTRACT_TYPE}"><tbody>` +
    '<tr><td style="text-align: center"><b>(الطرف الأول بصفته)</b></td><td style="text-align: center"><b>(الطرف الثاني)</b></td></tr>' +
    '<tr><td><b>الاسم/</b></td><td><b>الاسم/ {{employee.fullName}}</b></td></tr>' +
    '<tr><td><b>التوقيع/</b></td><td><b>التوقيع/</b></td></tr>' +
    '</tbody></table>',
].join('\n');

const CONTRACT: HiringPaper = {
  key: 'egycash.hiring.contract',
  name: { ar: 'عقد عمل محدد المدة', en: 'Fixed-term employment contract' },
  kind: 'contract',
  jobs: 'all',
  printOrder: 0,
  revision: 2,
  sections: {
    header: '',
    body: [
      // His basmala is calligraphy, a picture in his file: the paragraph shows it (`basmala`).
      '<p class="basmala">بسم الله الرحمن الرحيم</p>',
      '<p class="t20 l1" style="text-align: center"><b><u>عقد عمل محدد المدة</u></b></p>',
      CONTRACT_BODY,
    ].join('\n'),
    // His document-control line, at the foot of every page; the page number at the top.
    footer: docControl('EGYCASH-HR-F-10-04'),
  },
  signatures: [],
};

// ── «نموذج رقم (1)» — the social-insurance registration ─────────────────────────────────────

/**
 * «دا هنزودوا مع النمازج … نموزج 1 و العقد و خطاب البنك هما الوحيدين اللي هيتملو»; «عاوزين نخلي رقم
 * 2720 دا يبقا الاجر الاساسي في نموزج 1». The authority's form as he sent it (two pages, its own head
 * and emblem, no company letterhead or frame), FILLED from the record: the category, the company,
 * the employee's insurance number, national ID, name, nationality, qualification and job, the
 * start date in its boxes, the address, phone and email, the date it is written, his name in the
 * declaration overleaf — and the basic wage, 2720 pounds. What the record does not hold (the
 * establishment number, codes, signatures) stays for the hand.
 */
const boxes = (count: number, value = ''): string => `<span class="cells c${count}">${value}</span>`;
/** «يوم / شهر / سنة» in their boxes, right to left as the form draws them. */
const boxedDate = (day = '', month = '', year = ''): string => `${boxes(2, day)} / ${boxes(2, month)} / ${boxes(4, year)}`;
/** A wage in its boxes: five for the pounds, two for the piasters, written left to right. */
const wageBoxes = (pounds = '', piasters = ''): string => {
  const digits = (value: string, count: number): string =>
    value
      .padStart(count, ' ')
      .split('')
      .map((digit) => `<td>${digit === ' ' ? '&nbsp;' : digit}</td>`)
      .join('');
  return (
    '<table class="mini" dir="ltr"><tbody>' +
    '<tr><td colspan="5">جنيـــه</td><td colspan="2">قرش</td></tr>' +
    `<tr>${digits(pounds, 5)}${digits(piasters, 2)}</tr>` +
    '</tbody></table>'
  );
};
/** A boxed caption over boxes («نوع المدة», «كود الاشتراك»). */
const captionBoxes = (caption: string): string =>
  `<table class="mini"><tbody><tr><td colspan="2">${caption}</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table>`;
/** Label, value on a dotted line — one or more to a line. */
const filledLine = (cells: readonly (string | { value: string })[]): string =>
  `<table class="plain"><tbody><tr>${cells
    .map((cell) => (typeof cell === 'string' ? `<td>${cell}</td>` : `<td class="dots">${cell.value}</td>`))
    .join('')}</tr></tbody></table>`;

/** The basic wage the owner registers every new hire at: «رقم 2720 دا يبقا الاجر الاساسي». */
const INSURED_BASIC_WAGE = '2720';

const FORM_ONE: HiringPaper = {
  key: 'egycash.hiring.insurance-form-1',
  name: { ar: 'نموذج رقم (1) — طلب اشتراك مؤمن عليه', en: 'Form 1 — insured person registration' },
  kind: 'form',
  jobs: 'all',
  printOrder: 5,
  sections: {
    header:
      '<table class="plain cols ownhead"><tbody><tr>' +
      '<td><b>الهيئة القومية للتأمين الاجتماعي</b><br /><b>مكتب</b> ........................................</td>' +
      '<td><p class="nosi">الهيئة القومية للتأمين الاجتماعي</p></td>' +
      '<td style="text-align: left"><b>نموذج رقم (1)</b></td>' +
      '</tr></tbody></table>',
    body: [
      '<p class="rule">&nbsp;</p>',
      '<p class="t16" style="text-align: center"><b>طلـــب اشتراك مـؤمـــن عليـــه</b></p>',
      '<table class="plain cols"><tbody>' +
        `<tr><td><b>الفئة :</b> ${boxes(1, '١')} <b>عاملين لدى الغير</b> ${boxes(1, '✓')}</td><td>${boxes(1, '٢')} <b>أصحاب أعمال</b> ${boxes(1)}</td></tr>` +
        `<tr><td>${gap(12)}${boxes(1, '٣')} <b>المصريين بالخارج</b> ${boxes(1)}</td><td>${boxes(1, '٤')} <b>عمالة غير منتظمة</b> ${boxes(1)}</td></tr>` +
        '</tbody></table>',
      `<p><b>رقـــم المنشـــأة:</b> ${boxes(8)}${gap(30)}${boxes(2)}</p>`,
      filledLine(['<b>اسـم المنشـــأة:</b>', { value: '{{company.name}}' }]),
      '<p class="divider"><span>بيانات المؤمن عليه</span></p>',
      `<p><b>الرقــم التأمينـــي:</b> ${boxes(9, '{{employee.insuranceNumber}}')}</p>`,
      `<p><b>الرقــم القومـــي:</b> ${boxes(14, '{{employee.nationalId}}')}</p>`,
      filledLine(['<b>اسم المؤمن عليه:</b>', { value: '{{employee.fullName}}' }, '<b>الجنســـية:</b>', { value: '{{employee.nationality}}' }]),
      filledLine([
        '<b>المؤهـــل:</b>',
        { value: '{{employee.qualification}}' },
        `<b>كـود المهنة:</b> ${boxes(3)} / ${boxes(3)}`,
        '<b>المسمـى:</b>',
        { value: '{{job.title}}' },
      ]),
      `<p><b>تاريخ بـــدء الاشتـــراك:</b> ${boxedDate('{{employment.startDay}}', '{{employment.startMonth}}', '{{employment.startYear}}')}</p>`,
      filledLine([
        captionBoxes('نــوع المـدة'),
        '<b>المسمـى:</b>',
        { value: '' },
        captionBoxes('كود الاشتراك'),
        '<b>المسمـى:</b>',
        { value: '' },
        '<b>القطاع :</b>',
        { value: '' },
        boxes(1),
      ]),
      '<table class="plain cols"><tbody>' +
        `<tr><td><b>*أجر أساسي:</b> ${wageBoxes(INSURED_BASIC_WAGE, '00')}</td><td><b>*أجر /دخل الاشتراك :</b> ${wageBoxes()}</td><td><b>*الأجر الشامل :</b> ${wageBoxes()}</td></tr>` +
        '<tr><td class="t10"><b>(لحساب ٧٪ وفقاً لقانون العمل )</b></td><td></td><td class="t10"><b>(لحساب اشتراك التأمين الصحي الشامل)</b></td></tr>' +
        '</tbody></table>',
      filledLine([`<b>صلة القرابة بصاحب العمل:</b> ${boxes(1)}`, { value: '' }, '<b>* تستوفى للأقارب حتى الدرجة الثانية بالمنشآت الفردية.</b>']),
      filledLine([`<b>بيانات العجز إن وجدت:تاريخ بداية العجز:</b> ${boxedDate()}`, '<b>نسبة العجز:</b>', { value: '' }, '٪']),
      '<p class="divider"><span>بيانات محل إقامة المؤمن عليه</span></p>',
      '<table class="plain cols"><tbody>' +
        '<tr><td style="text-align: center"><b>العنوان داخل مصر</b></td><td style="text-align: center"><b>العنوان خارج مصر</b></td></tr>' +
        `<tr><td><b>عقـار رقـم :</b> ${boxes(4)}</td><td><b>الدولة :</b> .............................. ${boxes(2)}</td></tr>` +
        `<tr><td><b>شياخة / قرية :</b> ${boxes(2)}</td><td><b>المدينة :</b> .............................. ${boxes(2)}</td></tr>` +
        '<tr><td><b>شارع / حارة:</b> {{employee.address}}</td><td><b>جهة العمل:</b> ..............................</td></tr>' +
        `<tr><td><b>قسم / مركز:</b> ${boxes(2)}${gap(4)}<b>محافظة :</b> ${boxes(2)}</td><td></td></tr>` +
        '<tr><td><b>توقيع المؤمن عليه:</b> ..............................</td><td><b>توقيع المدير المسئول:</b> ..............................</td></tr>' +
        '</tbody></table>',
      '<p><b>رقم التليفون :</b> {{employee.phone}}</p>',
      '<p><b>البريد الإلكتروني :</b> {{employee.email}}</p>',
      '<p><b>تحريراً في:</b> {{contract.currentDate}}</p>',
      '<p style="text-align: left"><b>تم مطابقة التوقيع بمعرفتي:</b> ................................................</p>',
      '<table><tbody>' +
        '<tr><td><b>البيــان</b></td><td style="text-align: center"><b>مستلـم الطلب</b></td><td style="text-align: center"><b>المراجـــع</b></td><td style="text-align: center"><b>سجل آليــاً بمعرفة</b></td><td style="text-align: center"><b>روجـع آليـاً بمعرفة</b></td></tr>' +
        ['الاســـم', 'التوقيـــع', 'التاريـــخ']
          .map((row) => `<tr><td><b>${row}</b></td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`)
          .join('') +
        '</tbody></table>',
      `<p class="t10"><b>ملحوظة</b>: على صاحب العمل والعامل الإطلاع على التوجيهات الموضحة خلف النموذج مع التوقيع على الإقرار.${gap(4)}(أنظر خلفه)</p>`,
      // ── Overleaf ──
      '<p class="newpage">&nbsp;</p>',
      '<p class="t14" style="text-align: center"><b>إرشـــادات</b></p>',
      '<p class="t12 l15" style="text-align: justify"><b>١. على صاحب العمل بالقطاع الخاص أن يرسل هذا النموذج من أصل وصورتين بالنسبة لكل مـــن العاملين لديه مع طلب اشتراكه في الهيئة لأول مرة وخلال أسبوعين على الأكثر من تـاريخ التحـاق أي عامل جديد بالعمل لديه سواءً كان التحاقاً نهائياً أو تحت الاختبار.</b></p>',
      '<p class="t12 l15" style="text-align: justify"><b>٢. يرفق بالنموذج لدى اشتراك المؤمن عليه لأول مرة بالهيئة صورة شهادة الميلاد المميكنة وصورة بطاقة الرقم القومي أو صورة جواز السفر يتـــم مطابقتها على الأصل بمعرفة الموظف المختص.</b></p>',
      '<p class="t12 l15" style="text-align: justify"><b>٣. التوقيع على هذا النموذج بما يفيد الإطلاع والموافقة على جميع البيانات الـواردة بـه ولا يجوز لمـــن وقَّع عليه أن يعارض في تلك البيانات أمام الهيئة وله أن يلجأ إلى مكتب علاقات العمل المختص أو القضاء.</b></p>',
      '<p class="t12 l15"><b>٤. يستخدم هذا النموذج كطلب اشتراك في تأمين إصابات العمل فقط بالنسبة للفئات التالية:</b></p>',
      `<p class="t12 l15">${gap(8)}<b>(أ)  من تجاوز سن الشيخوخة وأوقف انتفاعه بتأمين الشيخوخة والعجز والوفاة.</b></p>`,
      `<p class="t12 l15">${gap(8)}<b>(ب)العاملون الذين يخضعون لأحكام قانون العمل ممن تقل أعمارهم عن ١٨ سنة.</b></p>`,
      `<p class="t12 l15" style="text-align: justify">${gap(8)}<b>(ج) العاملون المتدرجون والتلاميذ الصناعيون والطلاب المشتغلون في مشروعات التشغيل الصيفـي والخدمة العامة، ويشترط اعتمادالنموذج المحرر لهم من المدير المسئول بالهيئة التي تشرفعلى التلمذة الصناعية، والتدريب مع ختمها بخاتم هذه الجهة مع إرفاق نسخة من عقد عمل المتدرب أو المستند المثبت لنوع العمل في جميع هذه الحالات.</b></p>`,
      `<p class="t12 l15">${gap(8)}<b>(د)  يقتصر استيفاء الأجر على الفئات التي يتقاضى فيها المؤمن عليه أجراً من صاحب العمل.</b></p>`,
      '<p class="t14" style="text-align: center"><b>إقـــــرار</b></p>',
      filledLine(['<b>اســم المنشأة:</b>', { value: '{{company.name}}' }, '<b>رقمها التأميني:</b>', { value: '' }]),
      filledLine(['<b>العنـــــوان:</b>', { value: '' }]),
      '<p class="t12 l15" style="text-align: justify"><b>أقر أنـا الموقِّع علـى هـذا النمـوذج بـالالتزام بعـرض المـؤمن عليـه علـى اللجنـة الطبيـة المختصـة بالهيئـة المعنيةبالتأمين الصحي أو الجهة الطبية المختصة لإجراء الفحص الطبي الأولي وإثبات حالته الصحية وقت توقيع الكشف الطبي مع الالتزام بموافاة مكتب الهيئة التابع لـه المنشأة بتقرير اللياقة الطبية الصادر من الجهة الطبية المختصة عن حالته الصحية خلالأسبوعين على الأكثر من تـاريخ التحاقه بالعمل تطبيقاًلأحكام قـانون العمل.</b></p>',
      '<p class="t12 l15"><b>توقيع (صاحب العمل / المدير المسئول)</b></p>',
      `<p class="t12 l15">${gap(16)}(${gap(44)})</p>`,
      '<p class="t12 l15" style="text-align: justify"><b>١- أقر أنا {{employee.fullName}} العامل بالمنشأة عاليه بـأن أثبت حـالتي الصحية أمام اللجنة الطبية المختصـة بالهيئة المعنيـة بالتأمين الصـحي أو الجهة الطبية المختصة وموافـاة مكتب الهيئة التابع له المنشــأة بالتقرير الطبي عن حالتي الصحية خلال أسبوعين من تاريخ التحاقي بالعمـل وفي حالـة عــدم قيامي بذلك فــإن الهيئة القومية للتأمين الاجتماعي ليس عليها أدنــى التزام قانونــي بصرف أية مستحقات تأمينية تترتب على العجز أياً كان نوعه السابق أو المعاصر لتاريخ الالتحاق بالعمل.</b></p>',
      `<p class="t12 l15">${gap(30)}<b>توقيع المؤمن عليه</b></p>`,
      `<p class="t12 l15">${gap(24)}(${gap(44)})</p>`,
    ].join('\n'),
    footer: '',
  },
  signatures: [],
};

// ── The forms every job signs ────────────────────────────────────────────────────────────────

const DATA_SHEET: HiringPaper = {
  key: 'egycash.hiring.data-sheet',
  name: { ar: 'صحيفة بيانات', en: 'Personal data sheet' },
  kind: 'form',
  jobs: 'all',
  printOrder: 10,
  revision: 2,
  sections: {
    header: heading('صـحـيـفــة بـيــانــات', 't14'),
    body: [
      `<p>تحريراً فى : ${handDate('20')}</p>`,
      shaded('الـبـيــانــات الـشـخـصـيـــة'),
      line(['الإســـم :', null, 'تـاريـخ الميــلاد :', null]),
      line(['الـرقـم الـقـومــي :', null, 'الـموقف من التجنـيـد :', null]),
      line(['الـعـنـوان :', null]),
      line(['رقـم الـتـلـيـفــون :', null, 'رقم هاتف للطوارئى :', null, 'الصفه(.......)']),
      shaded('الـمــؤهــلات الــدراسـيــة'),
      line(['الـمؤهــل الـدراســي :', null, 'سـنــة الـتخـــرج :', null]),
      line(['جـهـة الـحصـول عـليـه :', null, 'مـؤهــلات اخـــرى :', null]),
      shaded('الـحـالـة الاجـتـمـاعـيـة'),
      '<p>الـحـالــة الإجـتمــاعـيـــة : ................................ ( أعزب – متزوج – أرمل – مطلق )</p>',
      '<ul><li><u>بـيـانــات من يعول</u></li></ul>',
      '<table><tbody>' +
        '<tr><td style="text-align: center">#</td><td style="text-align: center">الإسـم</td><td style="text-align: center">تـاريــخ الـمـيــلاد</td><td style="text-align: center">صـلـة الـقـرابــة</td></tr>' +
        [1, 2, 3, 4, 5].map(() => '<tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>').join('') +
        '</tbody></table>',
      '<p class="l15" style="text-align: justify">أقر وأتعهد بأن جميع المعلومات الواردة بهذه الصحيفة و الخاصة بي صحيحة و كاملة، و أني علي دراية تامة بأنه في حالة ثبوت خطأ في تلك المعلومـــات فإن ذلك قـد يؤدى إلي إتخاذ الشركة لكافة الإجراءات القانونية ، و كذا أتعهد بإبلاغ إدارة الموارد البشرية بأى  تعديلات قد تطرأ على البيانات المذكورة .</p>',
      '<p style="text-align: center">الإســــــم :</p>',
      '<p style="text-align: center">الـتـوقـيــع :</p>',
    ].join('\n'),
    footer: docControl('EGYCASH-HR-F-10-04'),
  },
  signatures: [],
};

const WORK_RECEIPT: HiringPaper = {
  key: 'egycash.hiring.work-receipt',
  name: { ar: 'إقرار استلام العمل', en: 'Work commencement declaration' },
  kind: 'form',
  jobs: 'all',
  printOrder: 20,
  revision: 2,
  sections: {
    header: heading('إقـرار إسـتـلام العـمـل', 't12'),
    body: [
      `<p class="l2"><b>أنـه فـى يـوم : ${handDate('202')}</b></p>`,
      line(['<b>إسـتـلـمـت أنـا :</b>', null], 'l3'),
      line(['<b>رقــم قــومــى :</b>', null], 'l3'),
      line(['<b>الموقـــــــــــع :</b>', null], 'l3'),
      line(['<b>الـعـمـل بـإدارة :</b>', null], 'l3'),
      line(['<b>بــوظـيـفــــــــة :</b>', null], 'l3'),
      '<p class="l2">&nbsp;</p>',
      '<p class="l2" style="text-align: center"><b>و بنــــاءاً عليــه أقر بأننى قد تسلمت مهام وظيفتى بـــدءاً من هــــــذا التـــاريخ و هـــــذا إقرار منــــى بــذلك .</b></p>',
      '<p class="l2">&nbsp;</p>',
      apart('<b>الـمـقـر بـما فـيـه</b>', '<b>الـمديـر الـمبـاشــر</b>', 'l2'),
    ].join('\n'),
    footer: docControl('EGYCASH-HR-F-10-05'),
  },
  signatures: [],
};

const RELATIVES: HiringPaper = {
  key: 'egycash.hiring.relatives',
  name: { ar: 'إقرار أقارب', en: 'Relatives declaration' },
  kind: 'form',
  jobs: 'all',
  printOrder: 30,
  revision: 2,
  sections: {
    header: heading('اقـــــرار', 't16'),
    body: [
      `<p class="t14 l2" style="text-align: justify">اقر انا /${gap(44)}بانني لا يوجد لدى اقارب يعملون بشركة إيجى كاش للحلول النقدية واتحمل المسئولية الكاملة فى حالة ثبوت مايخالف ذلك مستقبلا وللشركة الحق فى اتخاذ الاجراء المناسب حيال ذلك  .</p>`,
      '<p class="t16 l2" style="text-align: center">وهذا اقرار منى بذلك ،،،</p>',
      `<p class="t16 l2" style="text-align: left">المقر بما فية${gap(24)}</p>`,
      '<p class="t16 l2" style="text-align: center">الاسم :</p>',
      '<p class="t16 l2" style="text-align: center">الرقم القومى :</p>',
      '<p class="t16 l2" style="text-align: center">التوقيع :</p>',
      '<p class="t16 l2" style="text-align: center">التاريخ :</p>',
    ].join('\n'),
    footer: docControl('EGYCASH-HR-F-10-03'),
  },
  signatures: [],
};

/**
 * The one form that is still FILLED (with the contract and «نموذج رقم (1)»): «خطاب البنك … كله
 * بيتعملي لوحدو علي حسب مين الشخص و الكود … الحاجه الوحيده المتغيره هي الفرع». His layout: bold
 * 14pt at 1.5 lines, the employee's facts as label : value rows without borders.
 */
const BANK_LETTER: HiringPaper = {
  key: 'egycash.hiring.bank-letter',
  name: { ar: 'خطاب بنك', en: 'Bank letter' },
  kind: 'form',
  jobs: 'all',
  printOrder: 40,
  revision: 2,
  sections: {
    header: heading('خطاب بنك', 't14'),
    body: [
      '<p class="t14 l15"><b>السادة البنك الاهلى المصرى فرع / ..................</b></p>',
      '<p class="t14 l15"><b>تحية طيبة و بعد</b></p>',
      '<p class="t14 l15" style="text-align: justify"><b>يرجى من سيادتكم فتح حسابات المرتبات تحت كود و اسم الشركة المسجلة لدى بنككم الموقر للموظفين التالى بيانهم و المرجين بالشركة و على قوة و طبقا للبيانات التالية :</b></p>',
      '<ul class="t14 l15">' +
        '<li><b>فتح حساب جارى مرتبات</b></li>' +
        '<li><b>ربط الحساب بكود الشركة (12879)</b></li>' +
        '<li><b>ربط الحساب بكود الموظف {{employee.employeeCode}}</b></li>' +
        '</ul>',
      '<p class="t14 l15"><b><u>شركة ايجى كاش للحلول النقدية</u></b></p>',
      '<table class="plain t14 l15"><tbody>' +
        '<tr><td><b>كود الموظف</b></td><td><b>:</b></td><td><b>{{employee.employeeCode}}</b></td></tr>' +
        '<tr><td><b>الاســــــــــم</b></td><td><b>:</b></td><td><b>{{employee.fullName}}</b></td></tr>' +
        '<tr><td><b>تاريخ التعيين</b></td><td><b>:</b></td><td><b>{{employee.hireDate}}</b></td></tr>' +
        '<tr><td><b>الوظيفـــــــة</b></td><td><b>:</b></td><td><b>{{job.title}}</b></td></tr>' +
        '<tr><td><b>الرقم القومى</b></td><td><b>:</b></td><td><b>{{employee.nationalId}}</b></td></tr>' +
        '<tr><td><b>رقم موبايــل</b></td><td><b>:</b></td><td><b>{{employee.phone}}</b></td></tr>' +
        '</tbody></table>',
      '<p class="t14 l15" style="text-align: center"><b>تفضلو بقبول فائق الاحترام</b></p>',
      '<p class="t14 l15">&nbsp;</p>',
      `<p class="t14 l15" style="text-align: left"><b>إدارة الموارد البشرية</b>${gap(10)}</p>`,
    ].join('\n'),
    footer: '',
  },
  signatures: [],
};

// ── The crew leader's weapon declaration ─────────────────────────────────────────────────────

/** «قائد طاقم» alone — the crew leader the workforce book records. */
const CREW_LEADER = 'قائد طاقم';

const WEAPON: HiringPaper = {
  key: 'egycash.hiring.weapon',
  name: { ar: 'إقرار حيازة سلاح', en: 'Weapon possession declaration' },
  kind: 'form',
  // Crew leaders (of every kind) and cash-in-transit specialists — required of the first, optional
  // for the second when the signed copy is collected; printed for both.
  jobs: WEAPON_HOLDERS,
  // «اخصائي نقل اموال بتبقا اوبشن … منغير علامه»: offered to the specialist, unticked.
  optionalFor: CIT_SPECIALISTS,
  printOrder: 50,
  revision: 2,
  sections: {
    header: heading('إقـرار حيازة سلاح', 't16'),
    body: [
      `<p class="l2"><b>التاريخ : ${handDate('202')}</b></p>`,
      `<p class="t14 l2" style="text-align: justify">اقر انا / ..............................................${gap(8)}رقم قومى / ....................................... باننى احمل رخصة سلاح سارية بتاريخ إنتهاء ${handDate('202')} وان السلاح الشخصى المرخص فى حيازتى الشخصية و تحت مسؤوليتى و اتحمل المسئولية الكاملة فى حالة ثبوت مايخالف ذلك مستقبلا وللشركة الحق فى اتخاذ الاجراء المناسب حيال ذلك.</p>`,
      '<p class="t16 l2" style="text-align: center">وهذا اقرار منى بذلك ،،،</p>',
      '<p><b>الـتـوقـيـع/</b></p>',
      '<p class="rule l2">&nbsp;</p>',
      apart('<b>إدراة الـمـوارد الـبـشـريـة</b>', '<b>إدارة الأمـــن</b>', 't14 l2'),
    ].join('\n'),
    footer: '',
  },
  signatures: [],
};

// ── The job description cards ────────────────────────────────────────────────────────────────

/** One duty, or one duty with the items it lists under it. */
type Duty = string | { text: string; items: readonly string[] };

interface JobCard {
  key: string;
  name: LocalizedString;
  jobs: PaperJobs;
  /** As printed on the card. */
  jobTitle: string;
  manager: string;
  department: string;
  frame: string;
  /** Grouped under headings on a card that groups them («اولا : البوابة الرئيسية»). */
  duties: readonly { heading?: string; items: readonly Duty[] }[];
  supervision: string;
  responsibilities: readonly string[];
}

const duty = (item: Duty): string =>
  typeof item === 'string'
    ? `<li>${item}</li>`
    : `<li>${item.text}<ul>${item.items.map((sub) => `<li>${sub}</li>`).join('')}</ul></li>`;

/**
 * His cards come in two shapes. Three (the ATM specialist's, the preparation specialist's, the ATM
 * crew leader's) set the job, manager and department in four columns and spell «الإدارة»,
 * «الإطـار», «الـمـسـئـولـية»; the other four write each label and its value in one cell and spell
 * «الادارة», «الاطـار», «الـمـسـئـولـيه». Each card keeps its own.
 */
const JOINED_CARDS: ReadonlySet<string> = new Set([
  'egycash.hiring.card.counting-specialist',
  'egycash.hiring.card.cit-specialist',
  'egycash.hiring.card.treasurer',
  'egycash.hiring.card.security-guard',
]);

const jobCardPaper = (card: JobCard): HiringPaper => {
  const joined = JOINED_CARDS.has(card.key);
  const facts = joined
    ? '<table class="plain cols l2"><tbody>' +
      `<tr><td><b>الـمـسـمـى الـوظـيـفـي : ${card.jobTitle}</b></td><td><b>الـمـديــر الـمـبـاشـر : ${card.manager}</b></td></tr>` +
      `<tr><td><b>الادارة الـتـابـع لـهـا : ${card.department}</b></td><td></td></tr>` +
      '</tbody></table>'
    : '<table class="plain cols l2"><tbody>' +
      `<tr><td><b>الـمـسـمـى الـوظـيـفـي :</b></td><td><b>${card.jobTitle}</b></td><td><b>الـمـديــر الـمـبـاشـر :</b></td><td><b>${card.manager}</b></td></tr>` +
      `<tr><td><b>الإدارة الـتـابـع لـهـا :</b></td><td><b>${card.department}</b></td><td></td><td></td></tr>` +
      '</tbody></table>';
  return {
    key: card.key,
    name: card.name,
    kind: 'form',
    jobs: card.jobs,
    printOrder: 60,
    revision: 2,
    sections: {
      header: heading('بـطـاقـة وصـف وظـيـفـي', 't12'),
      body: [
        facts,
        '<p class="rule">&nbsp;</p>',
        `<p class="l2"><b><u>${joined ? 'الاطـار' : 'الإطـار'} الـعـام للـوظـيـفة  :</u></b>  ${card.frame}</p>`,
        '<p class="l2"><b><u>مـهام شـاغـل الـوظـيـفـة  :</u></b></p>',
        ...card.duties.map(
          (group) =>
            (group.heading === undefined ? '' : `<p class="l2"><b><u>${group.heading}</u></b></p>`) +
            `<ul class="l2">${group.items.map(duty).join('')}</ul>`,
        ),
        '<p class="l2">&nbsp;</p>',
        `<p class="l2"><b><u>نــطـاق الاشــراف :</u></b>  ${card.supervision}</p>`,
        `<p class="l2"><b><u>نـطـاق الـمـسـئـولـي${joined ? 'ه' : 'ة'} :</u></b></p>`,
        `<ul class="l2">${card.responsibilities.map((item) => `<li>${item}</li>`).join('')}</ul>`,
        '<p class="rule">&nbsp;</p>',
        '<table class="plain l2"><tbody><tr><td><b>الإسم :</b></td></tr><tr><td><b>التوقيع :</b></td></tr></tbody></table>',
      ].join('\n'),
      footer: '',
    },
    signatures: [],
  };
};

/** Every card's closing duty of discretion, word for word. */
const DISCRETION =
  'الحفاظ على سرية المعلومات والبيانات الخاصة بالعمل وعدم الافصاح عنها لاية جهات رسمية او غير رسمية وعدم استخدام اية مستلزمات او ادوات عمل فى غير ما خصصت له .';
const NONE = 'لا يــوجــد .';

const JOB_CARDS: readonly JobCard[] = [
  {
    key: 'egycash.hiring.card.atm-specialist',
    name: { ar: 'بطاقة وصف وظيفي — أخصائي صراف آلي', en: 'Job description — ATM specialist' },
    jobs: { family: ['أخصائى صراف آلى'] },
    jobTitle: 'أخـصـائـى صـراف آلـى',
    manager: 'مـشـرف تـشـغـيـل الـصـراف آلـى',
    department: 'عـمـلـيـات الـصـراف الآلـى',
    frame: 'تغذيه و إجراء الصيانه الأوليه لماكينات الصراف اللآلي .',
    duties: [
      {
        items: [
          'استلام مهمات اليوم من خدمه العملاء (تغذيه - اعطال - صيانه) مع التوقيع علي قائمه المستلزمات بالتضامن مع اخصائي قائد الطاقم .',
          'التوقيع علي قائمه مستلزمات التشغيل .',
          {
            text: 'استلام مستلزمات التشغيل و التغذيه من الخزينه مع مطابقه القائمه للأدوات المستلمه :',
            items: [
              'مفتاح الماكينه (يكون في عهده قائد الطاقم) و الرقم السري (يكون في عهده اخصائي الصراف الآلي) .',
              'السلاح للاخصائين المصرح لهم بحمل سلاح .',
              'ادراج النقود (الكاسيتات) .',
            ],
          },
          'تحميل السياره بصناديق النقود (الكاسيتات) و الادوات المطلوبة .',
          'فتح الماكينه بالمفتاح (حيث يكون في حيازة القائد) و الرقم السري (حيث يكون في حيازه الاخصائي) .',
          'تغذيه الماكينات طبقاً للتعليمات و الخطوات الصحيحة و المعايير المطلوبة من قبل البنك .',
          'عمل الصيانه الاوليه للماكينات (التي لا تستوجب فك اي جزء من اجزاءها) مثل : تنظيف الحساسات و اخراج الكروت المحشوره .',
          'اثبات النقديه المحشوره و و ضعها في ظرف مغلق مع كتابه التاريخ و الوقت و التوقيع عليها من قبل القائد .',
          'التأكد من عدم ترك الماكينه الا بعد دخولها الخدمة .',
          'تسليم رواجع الماكينات و مستلزمات التشغيل .',
        ],
      },
    ],
    supervision: NONE,
    responsibilities: [DISCRETION, 'شريك متضامن فى المسئوليه عن شحنات الصراف الآلى ومستلزمات التشغيل .'],
  },
  {
    key: 'egycash.hiring.card.counting-specialist',
    name: { ar: 'بطاقة وصف وظيفي — أخصائي عد وفرز', en: 'Job description — counting specialist' },
    jobs: { family: ['أخصائى عد و فرز'] },
    jobTitle: 'أخـصـائـى عـد و فـرز',
    manager: 'مـشـرف عـد و فـرز',
    department: 'عـمـلـيـات مـركـز الـنـقـديـة',
    frame: 'عد النقدية الواردة و الصادرة من و الى الشركة .',
    duties: [
      {
        items: [
          'إستلام تقرير بالرصيد و البنك و النقدية لتشغيلة اليوم سواء كانت من الخزينة او من عمليات الصراف الآلى .',
          'استلام الكاستات و التأكد من اختيار الكاست الصحيح الخاص بكل ماكينة حسب المكتوب في التقرير .',
          'عد النقدية ومطابقتها بالرصيد المكتوب في التقرير .',
          'رص النقدية بالطريقة الصحيحة مع مراعاه أن كل كاست لة فئة معينه من النقدية .',
          'تسليم الكاستات بالنقدية المجهزة الى مشرف العد و الفرز .',
          'استلام النقدية الخاصة برواجع ماكينات الصراف الآلى .',
          'عد النقدية و مطابقتها بالتقرير الخاص بكل ماكينة .',
          'تسليم الرواجع لمشرف العد و الفرز و التقارير الملحقة بكل فئة .',
        ],
      },
    ],
    supervision: NONE,
    responsibilities: ['مسئولية تضامنية عن المبالغ النقدية', DISCRETION],
  },
  {
    key: 'egycash.hiring.card.cit-specialist',
    name: { ar: 'بطاقة وصف وظيفي — أخصائي نقل أموال', en: 'Job description — cash-in-transit specialist' },
    jobs: CIT_SPECIALISTS,
    jobTitle: 'أخـصـائـى نـقـل امـوال',
    manager: 'مـشـرف تـشـغـيـل نـقـل الأمـوال',
    department: 'نـقـل الأموال',
    frame: 'القيام بهمام تجهيز ونقل شحنات الاموال من والى سيارة نقل الاموال وذلك تحت اشراف فني وامني لقائد الطاقم .',
    duties: [
      {
        items: [
          'استلام امر التشغيل من الخزينة والتوقيع كشريك متضامن فى المسئوليه عن الشحنة .',
          'تجهيز شحنات الاموال داخل الحقائب لدى العميل وذلك طبقا لطريقة الرص الخاصة بكل فئة واغلاق الحقائب بالقفل المعد لذلك مع الاخذ فى الاعتبار عدد الاقفال المتفق عليه لدى كل عميل وذلك طبقا لتوجيهات قائد الطاقم .',
          'نقل حقائب الاموال او العبوات الخاصة بالعميل من والى سيارة نقل الاموال سواء من موقع العميل او خزينة الشركة .',
          'تنفيذ رص حقائب نقل الاموال او العبوات الاخرى طبقا للطريقة المطلوبه لذلك سواء لدى العميل او داخل السيارة .',
          'التاكيد على عدد حقائب الاموال فى جميع مراحل استلام وتسليم الشحنات طبقا لامر التشغيل وابلاغ قائد الطاقم بالاعداد .',
          'تنفيذ توجيهات قائد الطاقم فى اية مستجدات قد تطرأ اثناء عمليات التسليم والتسلم .',
          'تنفيذ التوجيهات الامنية الصادرة من قائد الطاقم اثناء تنفيذ جميع المهام لضمان سلامة الارواح والممتلكات .',
        ],
      },
    ],
    supervision: NONE,
    responsibilities: ['شريك متضامن فى المسئوليه عن شحنات الاموال ومستلزمات التشغيل .', DISCRETION],
  },
  {
    key: 'egycash.hiring.card.preparation-specialist',
    name: { ar: 'بطاقة وصف وظيفي — أخصائي تجهيز', en: 'Job description — preparation specialist' },
    jobs: { family: ['أخصائى تجهيز'] },
    jobTitle: 'أخـصـائى تـجـهـيـز',
    manager: 'مـشـرف تـجـهـيـز',
    department: 'الـصـراف الآلـى',
    frame: 'تجهيز أدراج النقود (الكاسيتات) الخاصة بالماكينات لتكون معدة لاجراء عملية التغذية .',
    duties: [
      {
        items: [
          'إستلام محضر جرد الماكينه الذى يتكون من (حالتها – رقم الماكينه – المنطقه – الفئات المتاحه) من مشرف التجهيز .',
          'عد الفئات الخاصه بكل درج نقود (كاسيت) و ترتيبها بالطريقه الصحيحه الخاصه بكل فئه و ماكينه .',
          'تعبئة أدراج النقود (الكاسيتات) طبقا للفئات المثبتة على محضر الجرد و تكون مطابقة لنوع الماكينة بعد مراجعة المشرف .',
          'غلق ادراج النقود (الكاسيتات) بالسيلز المخصص لها مع التأكد من وجود اخر بداخلها .',
          'تسليم ادراج النقود (الكاسيتات) المجهزه لمشرف التجهيز .',
          'جرد الماكينة و عد جميع إدراج النقود (الكاسيتات) .',
          'تسليم الرواجع للمشرف بعد مطابقتها بمحضر جرد الماكينه للتأكد بعدم وجود اى عجز او نقص بالنقدية .',
        ],
      },
    ],
    supervision: NONE,
    responsibilities: [DISCRETION, 'مسئولية تضامنية عن المبالغ النقدية وكذا الاجزاء الخاصة بماكينات الصراف الالى .'],
  },
  {
    key: 'egycash.hiring.card.treasurer',
    name: { ar: 'بطاقة وصف وظيفي — أمين خزينة', en: 'Job description — treasurer' },
    jobs: { family: ['أمين خزينة'] },
    jobTitle: 'أمـيـن خـزيـنـة',
    manager: 'مـشـرف خـزيـنـة',
    department: 'عـمـلـيـات مـركـز الـنـقـديـة',
    frame: 'استلام و تسليم عهده إداراة العمليات .',
    duties: [
      {
        items: [
          'استلام مفاتيح الخزينة و التوقيع على دفتر إستلامها .',
          'استلام الشحنات عن طريق دفتر الوارد و مطابقة السيلز و حالة الحقائب .',
          'استلام أوامر التشغيل و تجهيزها حسب موعد خروجا من مسؤل العمليات .',
          'تسليم الشحنات و المفاتيح الى قادة الاطقم طبقا لإوامر التشغيل مع توقيع قاده الأطقم على الإستلام .',
          'إتمام غلق الخزينة و تسليم المفاتيح مع التوقيع في الدفتر المختص بالتسليم .',
        ],
      },
    ],
    supervision: NONE,
    responsibilities: ['المفاتيح الخاصة بإدارة العمليات .', DISCRETION],
  },
  {
    key: 'egycash.hiring.card.atm-crew-leader',
    name: { ar: 'بطاقة وصف وظيفي — قائد طاقم صراف آلي', en: 'Job description — ATM crew leader' },
    // «قائد طاقم» alone is the crew leader the workforce book records; a crew leader named for
    // another line of work («قائد طاقم نقل أموال») is not an ATM crew leader.
    jobs: { family: ['قائد طاقم صراف آلى'], exact: [CREW_LEADER] },
    jobTitle: 'قائــد طــاقــم صـراف آلـى',
    manager: 'مشرف تشغيل صراف آلى',
    department: 'عـمـلـيـات الـصـراف الآلـى',
    frame: 'الإشراف على تغذية و إجراء الصيانه الأوليه لماكينات الصراف اللآلى و تأمين السيارة .',
    duties: [
      {
        items: [
          'استلام مهمات اليوم من خدمه العملاء (تغذيه - اعطال - صيانه) مع التوقيع علي قائمه المستلزمات بالتضامن مع اخصائي الصراف الآلى .',
          {
            text: 'استلام مستلزمات التشغيل و التغذيه من الخزينه مع مطابقه القائمه للأدوات المستلمه و التوقيع علي استلامها و التى تتمثل فى :',
            items: [
              'مفتاح الماكينه (يكون في عهده قائد الطاقم) .',
              'الرقم السري (يكون في عهده اخصائي الصراف الآلي) .',
              'جهاز الاسلكي .',
              'السلاح بغرفه السلاح و الذخيره من الامن ادراج النقود (الكاسيتات) .',
            ],
          },
          'الاشراف علي تحميل السياره بأدراج النقود (الكاسيتات) الخاصة بكل ماكينة طبقا لخط السير.',
          'إخطار عمليات الصراف اللآلي هاتفيا ببدء و انتهاء العمل علي كل ماكينة .',
          'تصوير و توثيق الخطوات من بدء فتح الماكينه لحين غلقها بالتطبيق المخصص من الشركة .',
          'الاشراف علي فتح الماكينه بالمفتاح (حيث يكون في حيازه القائد) و الرقم السري (حيث يكون في حيازه الاخصائي) .',
          'الاشراف علي عمل اخصائي الصراف الآلي اثتاء عمليه التغذيه (يتطلب معرفه مسبقه بمهام الاخصائي و الخطوات الصحيحه للقيام بالمهمه) .',
          'التأكد من إثبات إجمالى النقديه المحشوره و ضعها في ظرف مغلق مع كتابه التاريخ و الوقت و إبلاغ العمليات .',
          'الاشراف علي خطوات الصيانه و ابلاغ العمليات في حاله وجود اعطال تستوجب وجود المهندس المختص .',
          'التأكد من وجود السائق بالسيارة أثناء القيام بمهام التغذية و الصيانة .',
          'تأمين الماكينه حتي يتم اغلاقها .',
          'ابلاغ العمليات في حاله حدوث تلف بالماكينه او مشاكل تعوق اداء المهمة .',
          'التأكد من عدم ترك الماكينه الا بعد دخولها الخدمة .',
          'تسليم رواجع الماكينات و باقي مستلزمات التشغيل(الغير مستهلكه) الي الخزينه مع التوقيع عليها .',
          'عمل تقرير بحاله كل ماكينه علي حدا و الاجراءات التي تمت بكل ماكينة مع إثبات توقيت كل ماكينة .',
          'تسليم المقاطع المصوره مع تقارير المكاينات لقسم خدمه العملاء يومياً فور العودة للمقر.',
        ],
      },
    ],
    supervision: 'إشـراف فـنـى عـلـى وظـائـف ( اخـصـائـى صراف آلى – سـائـق ) .',
    responsibilities: [
      DISCRETION,
      'سيارة الصراف الآلى واتخاذ كافة اجراءات الامن والسلامة الخاصة بها .',
      'ادراج النقود (الكاسيتات) سواء المستلمه من خزينة الشركة او من العملاء ومن ثم خزينة السيارة والتاكد من عدم فتحها الا بمعرفته .',
      'السلاح والتنفيذ الدقيق للتعليمات الصادره بشانه من قبل ادارة الامن .',
      'مستلزمات التشغيل والتاكد من الحفاظ عليها واستخدامها فى الاغراض المخصصه لها .',
    ],
  },
  {
    key: 'egycash.hiring.card.security-guard',
    name: { ar: 'بطاقة وصف وظيفي — مراقب أمن', en: 'Job description — security guard' },
    jobs: { family: ['مراقب أمن'] },
    jobTitle: 'مراقب امن',
    manager: 'مشرف الامن',
    department: 'الأمــن',
    frame: 'تنفيذ مهام تامين ومراقبة مداخل ومخارج مقرات الشركة .',
    duties: [
      {
        heading: 'اولا : البوابة الرئيسية',
        items: [
          'تنظيم دخول وخروج العاملين بالشركة .',
          'تسجيل الزائرين بالدفاتر الخاصة بالزيارات ( بيانات شخصية – الغرض من الزيارة – التوقيت – الإدارة المراد دخولها ) مع ابلاغ مسئول الادارة .',
          'تسجيل اية اصناف يتم دخولها او خروجها من الشركة مع توضيح انواعها وتاريخ الدخول او الخروج .',
          'تنظيم دخول الافراد لاجراء المقابلات الشخصية وذلك بالتنسيق مع ادارة الموارد البشرية ، مع ابلاغ مدير الامن في حالة وجود اية مخالفات تؤثر على سير العمل .',
        ],
      },
      {
        heading: 'ثانيا : صالة التحميل ومخزن السلاح',
        items: [
          'فتح وغلق الباب الرئيسي ( الشطر ) اثناء دخول وخروج السيارات بعد التاكد من هويتها .',
          'التاكد من استكمال طاقم السيارة قبل الخروج .',
          'تسجيل السيارات بالدفتر الخاص بذلك ( اتجاة المامورية – توقيت الخروج/الدخول ) .',
          'تسليم وتسلم السلاح من والى قادة الاطقم والتسجيل بدفتر السلاح .',
        ],
      },
      {
        heading: 'ثالثا: منطقة الخزائن',
        items: [
          'تامين منطقة الخزائن ومنع دخول الافراد الغير مصرح لهم بالدخول .',
          'فتح وغلق الرامب البديل اثناء دخول وخروج السيارات مع التسجيل بالدفاتر الخاصة بذلك .',
          'التاكد من استكمال طاقم السيارة قبل الخروج .',
        ],
      },
      {
        heading: 'رابعا: جراج الشركة',
        items: [
          'تسجيل توقيتات دخول وخروج السيارات بالدفاتر المعدة لذلك .',
          'الابلاغ عن اية مخالفات تحدث من السائقين او اية ملاحظات قد تطرأ على السيارات بالمخالفة مع تعليمات الشركة .',
          'عدم السماح بدخول اية سيارات غير تابعة للشركة .',
          'الحفاظ على تعليمات السلامة والصحة المهنية وعدم السماح بعمل اية توصيلات كهربائية او مياة او غيرها قد تتسبب فى حدوث اضرار.',
        ],
      },
      {
        heading: 'خامسا : غرفة الكاميرات',
        items: [
          'متاابعة ومراقبة كافة الكاميرات الداخلية والخارجية .',
          'الابلاغ الفورى لمدير الامن حال ملاحظة اية تحركات غير عادية سواء للعاملين بالشركة او افراد من خارج الشركة .',
          'الابلاغ عن اية اعطال قد تطرا على الكاميرات لضمان الجودة والاستمرارية .',
          'عمل تقرير يومي بكل المخالفات الامنية بالفرع وتقديمه لمدير الامن مع تسجيلها بدفتر سير الحوادث .',
        ],
      },
    ],
    supervision: 'لا يــوجــد',
    responsibilities: ['السلاح والذخيرة ان وجدت – نسخ المفاتيح – متعلقات الزائرين', DISCRETION],
  },
];

/** All fourteen, in the order they print. */
export const HIRING_PAPERS: readonly HiringPaper[] = [
  CONTRACT,
  FORM_ONE,
  DATA_SHEET,
  WORK_RECEIPT,
  RELATIVES,
  BANK_LETTER,
  WEAPON,
  ...JOB_CARDS.map(jobCardPaper),
];

/**
 * Is the paper `key` offered to the job named `jobName` unticked (`optionalFor`)? False for a paper
 * not written from this file, or a job whose name is unknown.
 */
export const optionalForJob = (key: string, jobName: string | null): boolean => {
  const optional = HIRING_PAPERS.find((paper) => paper.key === key)?.optionalFor;
  return optional !== undefined && jobName !== null && matchesJob(optional, jobName);
};
