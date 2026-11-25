// Turn a thrown value into a user-facing message. Server error messages are already
// human-readable; we override the common codes with friendlier bilingual copy and fall back
// to the server message, then to a generic string. Kept React-free so the global Query/Mutation
// error handler (outside the component tree) can use it via the store's current locale.
import { type Locale } from '@ecms/contracts';
import { ApiError } from './api-client';

const FRIENDLY: Record<Locale, Record<string, string>> = {
  en: {
    // P-ORG-3 — the org chart and job places (org-chart-design.md §5.5).
    ORG_UNIT_NOT_EDITABLE:
      'This unit cannot be edited here: it is not linked to the company list, or is stopped in it.',
    ORG_SECTION_NAME_TAKEN: 'This department already has a section with this name.',
    BRANCH_WITHOUT_DEPARTMENT:
      'In one of the ticked branches the department does not exist, or is not linked to the company list.',
    JOB_PLACE_NOT_ALLOWED:
      'The job cannot be placed here: the job or the section is stopped, or the section is not in this department.',
    ORG_CATALOG_ENTRY_IN_USE: 'Jobs are placed in this entry, so it cannot be deleted.',
    VALIDATION_FAILED: 'Some fields need your attention.',
    FORBIDDEN: 'You do not have permission to do that.',
    NOT_FOUND: 'That item could not be found.',
    CONFLICT: 'That action conflicts with the current state.',
    STALE_DOCUMENT: 'This record changed since you loaded it — please refresh and try again.',
    BUSINESS_RULE: 'That action is not allowed right now.',
    // An accident's transfer from other cars, refused inside the save (nothing written). The
    // form words both with their figures (`details`); these are the same refusals without them.
    FLEET_ACCIDENT_TRANSFER_SHORT:
      'The selected cars no longer have enough left for this amount — their figures changed since they were shown.',
    FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT:
      'The amount taken is more than this accident’s negative remaining.',
    // The shipments history refuses a range holding too many shipments rather than cutting it
    // short; the page says so in place, and this is the same refusal for a background refetch.
    OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE:
      'This range holds too many shipments to show at once — narrow the dates.',
    // A shipment's dates have a floor: «مينفعش لما يجى يضيف شحنه يختار تاريخ فات», and on an edit
    // «ميقدرش يحدد يوم قبل يوم اللى كانت عليه الشحنة». The shipment form words both itself
    // (`operations.shipment.errors.*`); these are the same refusals anywhere else they surface.
    OPERATIONS_SHIPMENT_DATE_IN_PAST:
      'A shipment cannot be dated on a day that has passed — choose today or a later day.',
    OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL:
      'A shipment’s date cannot move earlier than the day it was on — keep it, or choose a later day.',
    // «تاريخ التسليم تانى يوم الاستلام افتراضى وممكن يغير»: a محصنة may be delivered the day it is
    // collected or later, never before. The shipment form words it on its own box too.
    OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION:
      'The delivery date cannot come before the collection date — choose the same day or a later one.',
    // «اعملى ايقون اقدر اجيب منه اللى اتمسح»: a restore of a shipment someone else already brought
    // back. Nothing is lost — it is on its day again — and the deleted list refreshes behind it.
    OPERATIONS_SHIPMENT_NOT_DELETED:
      'This shipment is no longer deleted — it is already back on its day.',
    // Round 10, the secured shipment's acts. «الشاشه بتاعت استلام الخزينة لما تعمل صح ميقدر حد من
    // القادة او العمليات او الخزنه يعدل عليها»: once the vault has received it, an edit, a delete, a
    // receipt photo or a pickup undo is refused — the screens offer none of them, so these reach a
    // reader whose screen was read before the vault's ✓ (or a colleague's ✓, for the pickup).
    OPERATIONS_SECURED_LOCKED:
      'The vault has received this secured shipment — it can no longer be changed.',
    // Since Round 13 the vault receives without a pickup («والخزنه تستلم عادي»), so this reaches only
    // the desk's undo of a pickup ✓ that is no longer there — a colleague's undo got there first.
    OPERATIONS_SECURED_NOT_PICKED_UP:
      'There is no confirmed pickup on this secured shipment to take back — nobody has confirmed collecting it from the bank.',
    OPERATIONS_SECURED_ALREADY_PICKED_UP:
      'The pickup of this secured shipment is already confirmed — by its captain or by Operations.',
    // A cancelled receipt asked for a shipment no longer in the vault (dispatched since, or never in).
    OPERATIONS_SECURED_NOT_IN_VAULT:
      'This secured shipment is not in the vault — its receipt can no longer be cancelled.',
    // Round 33 B — «الشحنات المسلَّمة»'s ✓ and its undo. The dialog marks its own boxes; these are
    // the same refusals wherever else they surface (a row that moved under the screen).
    OPERATIONS_SHIPMENT_NOT_DELIVERED:
      'This shipment has not reached its bank yet — it can be confirmed once it is delivered.',
    OPERATIONS_DELIVERY_ALREADY_CONFIRMED: 'This delivery is already confirmed.',
    OPERATIONS_DELIVERY_NOT_CONFIRMED:
      'This delivery is not confirmed any more — there is nothing to undo.',
    OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED:
      'Enter the receipt number to confirm the delivery.',
    OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG: 'The receipt number is too long.',
    OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED:
      'Choose the bank billed for moving the shipment — “From” or “To”.',
    // Round 33 critic — the edit form, on a shipment whose delivery is confirmed with its receipt:
    // its two branches are what the bank billed was chosen between.
    OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED:
      'This delivery is confirmed with its receipt, and the bank billed was chosen between its two branches. Undo the confirmation on “Delivered shipments” first, then change “From branch” or “To branch”.',
    // Round 21b — «لو موجوده عندنا لا ك محصنة يبقى مينفعش ولو دخلت وخرجت واتكرر يبقى عادى»: a seal the
    // vault still holds on another محصنة. The receive form marks the seal and names that محصنة
    // itself; these are the same refusal wherever else it surfaces.
    OPERATIONS_SEAL_HELD_IN_VAULT:
      'A seal in this receipt is still in the vault on another secured shipment — it can be received again only once that shipment has left the vault.',
    // «صرف الخزينة» (Round 10): a delivery crew is planned on the shipment's own delivery day, and a
    // release takes the shipments a vehicle was assigned. The screen offers only what fits; these
    // reach a reader whose crew plan or list changed under the open dialog.
    OPERATIONS_CREW_DAY_MISMATCH:
      'That crew is not planned on this shipment’s delivery day — choose one of that day’s crews.',
    OPERATIONS_CREW_CAPTAIN_MISMATCH: 'That captain is no longer on the chosen vehicle’s crew.',
    OPERATIONS_DELIVERY_LEG_REQUIRED:
      'A shipment has no delivery crew yet — assign its crew before releasing it.',
    // «توزيع المحصنات» (Round 12): the save is all or nothing, and each refusal names the shipment
    // (the screen marks its card). These reach a desk whose screen was read before a colleague, the
    // vault or the captain acted — or that was left open past midnight.
    OPERATIONS_DISTRIBUTION_DAY_IN_PAST:
      'That day has passed — its vans have left, and its record is view only. Distribute today or a later day.',
    OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED:
      'A secured shipment on this screen has already left the vault — it can no longer be placed on a van.',
    OPERATIONS_DISTRIBUTION_NOT_ON_DAY:
      'A secured shipment is not due on this day — it cannot be placed on this day’s vans.',
    OPERATIONS_DISTRIBUTION_LEG_STARTED:
      'Its captain has already started this delivery in the app — it can no longer be moved or taken off his van.',
    // Round 25 — only a row of the «محصنة» type takes a محصنة.
    OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED:
      'That row is not of the secured type — it takes no new secured shipment. Choose a secured row.',
    // «تسليم المحصنات» (Round 17): the server refuses a handover of any van but today's. The screen
    // offers «تسليم» on today's vans only, so this reaches a page left open from another day — or
    // past midnight — and says the same rule the screen does.
    OPERATIONS_DISPATCH_NOT_TODAY:
      'A van is handed over only on the day it goes out — this van is not one of today’s.',
    // «لوحة التشغيلة» (Round 20): a save gave a row a type archived on the reference screen since it
    // was picked, or a direction no area answers («لازم اختار من الاتجاهات اللى موجوده»). The board
    // marks the row the refusal names (`planRefusal`); these are the words said with it. Round 28
    // retired the direction's refusal («عاوز الاتجاه اقدر اكتبه بايدى»): no server sends it now, and
    // its words stay only for an older server, said without marking a row.
    OPERATIONS_UNKNOWN_SHIFT_TYPE:
      'A row was given a shift type that is no longer active on the reference screen — choose another type on the marked row.',
    OPERATIONS_DIRECTION_NOT_AN_AREA:
      'A direction is not one of the areas on the reference screen — this server still refuses a direction typed by hand.',
    // Round 22 — «لو القائد غايب … مقدرش احطه على العربيه»: somebody attendance has absent or on
    // leave that day was put on a row. The board names him on the marked row (`planRefusal`).
    OPERATIONS_CREW_MEMBER_ABSENT: 'Somebody on a row is absent or on leave on this day.',
    // Round 23 — «ممنوع ان اعين قائد مكان اخصائى والعكس الا فى حالة انه قائد اخصائى»: somebody was
    // newly put in a slot his role does not fit. The board names him on the marked row.
    OPERATIONS_CREW_MEMBER_WRONG_SLOT:
      'Somebody is in a slot that is not their role’s — a captain in a specialist’s slot, or a specialist in the captain’s.',
    // Round 24 — «مكان بدون سيارة … يجيب كل السيارات اللى مش عليها طاقم واقدر اختار منهم»: a row was
    // given a vehicle the save cannot take, or a row holding محصنات was deleted.
    OPERATIONS_CREW_VEHICLE_NOT_ACTIVE:
      'The vehicle given to the marked row is not in service in Fleet — choose another.',
    OPERATIONS_CREW_VEHICLE_IN_WORKSHOP:
      'The vehicle given to the marked row is in the workshop on this day — choose another.',
    OPERATIONS_CREW_VEHICLE_TAKEN:
      'The vehicle given to the marked row already has another crew on this day — choose another.',
    OPERATIONS_CREW_ROW_HAS_SHIPMENTS:
      'A deleted row carries secured shipments. While they are in the vault, take them off it on «Secured distribution» first; once they have left the vault the row stays — it can be emptied, or given a vehicle.',
    // Round 32 — a past day is the board's record, view only: its save is refused. The board draws
    // no act on one; this reaches a board left open past midnight, or an older screen.
    OPERATIONS_CREW_DAY_IN_PAST:
      'That day has passed — its board is a record, view only. Plan today or a later day.',
    ATM_MAIL_POLL_BUSY:
      'A reading of the mailbox is already running — its result appears under «Last reading» in a moment.',
    // «عداد الطابعة» (IT consumables, 2026-11-19): a toner goes onto a printer with its counter. The
    // issue and «تعديل الجهاز» word each on the line's own field, with the figures (`details`);
    // these are the same refusals without them, wherever else they surface.
    IT_CONSUMABLE_COUNTER_REQUIRED:
      'This item takes the printer’s counter: name the printer it goes into and its counter reading, one cartridge a line.',
    IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS:
      'The counter reading must be higher than the last reading recorded for this printer — if its counter was reset, tick «The printer’s counter was reset».',
    IT_CONSUMABLE_COUNTER_ABOVE_NEXT:
      'This reading is dated before a later reading of the same printer, so it must be lower than that one.',
    // Administrative Affairs — the master data's refusals (administration-module-design-flows.md
    // §5.15). Each dialog also words the field a refusal names beside that field, from its
    // `details`; these are the refusals themselves, wherever they surface.
    ADMINISTRATION_DUPLICATE:
      'Another record, active or retired, already has this name, code or barcode — a retired one is brought back, not added again.',
    ADMINISTRATION_CATEGORY_PARENT_INVALID:
      'This category cannot go under that parent: categories have two levels, and a category with subcategories stays at the top.',
    ADMINISTRATION_STOCK_LEVELS_ORDER:
      'The stock levels are out of order: where set, minimum ≤ reorder point ≤ maximum.',
    // An item's unit or category, or one of a supplier's categories (P1b.1): said of whatever the
    // record names, never of one kind of record.
    ADMINISTRATION_REFERENCE_INACTIVE:
      'A unit or category chosen is retired, so no record can be given it anew — choose an active one.',
    ADMINISTRATION_SUBCATEGORY_REQUIRED:
      'The category chosen has subcategories — file the item under one of them.',
    ADMINISTRATION_EMPLOYEE_EXITED:
      'The keeper chosen has left — choose somebody who works here today.',
    ADMINISTRATION_DEACTIVATION_BLOCKED:
      'This warehouse cannot be retired while it holds stock or a document not yet ended names it.',
    ADMINISTRATION_ATTACHMENT_LIMIT:
      'This list already holds 20 documents, as many as it takes — remove one before adding another.',
    RATE_LIMITED: 'Too many requests — please slow down.',
    // The server's own sentence names the file category's internal key («…for category
    // administration-supplier-documents»), so no reader is ever shown it.
    FILE_TYPE_NOT_ALLOWED: 'This kind of file is not accepted here.',
    FILE_TOO_LARGE: 'That file is too large.',
    PAYLOAD_TOO_LARGE: 'What was sent is too large to save at once.',
    FILE_BLOCKED: 'The virus scanner blocked this file.',
    FILE_SCAN_PENDING: 'This file is still being scanned for viruses — try again in a moment.',
    // The 500 code. Without it a server fault fell through to the server's own
    // untranslated `Unexpected error`, which is what an Arabic user then read.
    INTERNAL: 'The server could not complete that request.',
    AUTH_TOKEN_EXPIRED: 'Your session expired — please sign in again.',
    AUTH_TOKEN_INVALID: 'Your session is no longer valid — please sign in again.',
    UNAUTHENTICATED: 'Your session has ended — please sign in again.',
    AUTH_SESSION_REVOKED: 'This session was signed out — please sign in again.',
    NETWORK: 'Network error — please check your connection.',
    UNKNOWN: 'Something went wrong. Please try again.',
  },
  ar: {
    // P-ORG-3 — شجرة الهيكل التنظيمي ومكان الوظيفة.
    ORG_UNIT_NOT_EDITABLE:
      'لا يمكن تعديل هذه الإدارة أو هذا القسم من هنا: غير مربوط بقائمة الشركة أو موقوف فيها.',
    ORG_SECTION_NAME_TAKEN: 'يوجد قسم بهذا الاسم في هذه الإدارة.',
    BRANCH_WITHOUT_DEPARTMENT:
      'الإدارة غير موجودة أو غير مربوطة بقائمة الشركة في أحد الفروع المحددة.',
    JOB_PLACE_NOT_ALLOWED:
      'لا يمكن وضع الوظيفة في هذا المكان: الوظيفة أو القسم موقوف، أو القسم لا يتبع هذه الإدارة.',
    ORG_CATALOG_ENTRY_IN_USE: 'توجد وظائف موضوعة في هذا البند، فلا يمكن حذفه.',
    VALIDATION_FAILED: 'بعض الحقول تحتاج إلى مراجعة.',
    FORBIDDEN: 'ليس لديك صلاحية للقيام بذلك.',
    NOT_FOUND: 'تعذّر العثور على هذا العنصر.',
    CONFLICT: 'هذا الإجراء يتعارض مع الحالة الحالية.',
    STALE_DOCUMENT: 'تم تعديل هذا السجل بعد تحميله — يُرجى التحديث والمحاولة مجددًا.',
    BUSINESS_RULE: 'هذا الإجراء غير مسموح حاليًا.',
    FLEET_ACCIDENT_TRANSFER_SHORT:
      'لم يعد في السيارات المحددة ما يكفي لهذا المبلغ، فقد تغيّرت أرقامها منذ عرضها.',
    FLEET_ACCIDENT_TRANSFER_OVER_DEFICIT: 'المبلغ المأخوذ أكبر من سالب هذا الحادث.',
    OPERATIONS_SHIPMENT_HISTORY_TOO_LARGE:
      'هذه المدة تضم شحنات أكثر مما يمكن عرضه مرة واحدة — يُرجى تضييق التاريخ.',
    OPERATIONS_SHIPMENT_DATE_IN_PAST:
      'لا يمكن تسجيل الشحنة بتاريخ يوم مضى — اختر اليوم أو يومًا بعده.',
    OPERATIONS_SHIPMENT_DATE_BEFORE_ORIGINAL:
      'لا يمكن تقديم تاريخ الشحنة عن اليوم الذي كانت عليه — أبقِه كما هو أو اختر يومًا بعده.',
    OPERATIONS_SHIPMENT_DELIVERY_BEFORE_COLLECTION:
      'لا يمكن أن يسبق تاريخ التسليم تاريخ الاستلام — اختر اليوم نفسه أو يومًا بعده.',
    OPERATIONS_SHIPMENT_NOT_DELETED: 'هذه الشحنة لم تعد محذوفة — فقد عادت إلى يومها بالفعل.',
    OPERATIONS_SECURED_LOCKED: 'استلمت الخزينة هذه المحصنة، فلم يعد تغييرها ممكنًا.',
    OPERATIONS_SECURED_NOT_PICKED_UP:
      'لا يوجد تأكيد استلام لهذه المحصنة لإلغائه — لم يؤكد أحد استلامها من البنك.',
    OPERATIONS_SECURED_ALREADY_PICKED_UP:
      'استلام هذه المحصنة مؤكَّد بالفعل — من قائدها أو من العمليات.',
    OPERATIONS_SECURED_NOT_IN_VAULT: 'هذه المحصنة ليست بالخزينة، فلم يعد إلغاء استلامها ممكنًا.',
    OPERATIONS_SHIPMENT_NOT_DELIVERED: 'لم تصل هذه الشحنة إلى بنكها بعد، فلا يمكن تأكيد تسليمها.',
    OPERATIONS_DELIVERY_ALREADY_CONFIRMED: 'هذا التسليم مؤكَّد بالفعل.',
    OPERATIONS_DELIVERY_NOT_CONFIRMED: 'لم يعد هذا التسليم مؤكَّدًا، فلا يوجد ما يُلغى.',
    OPERATIONS_DELIVERY_RECEIPT_NUMBER_REQUIRED: 'أدخل رقم الإيصال لتأكيد التسليم.',
    OPERATIONS_DELIVERY_RECEIPT_NUMBER_TOO_LONG: 'رقم الإيصال أطول من المسموح.',
    OPERATIONS_DELIVERY_BILLED_SIDE_REQUIRED:
      'اختر البنك الذي تُحتسب عليه تكلفة النقل: «من» أو «إلى».',
    OPERATIONS_DELIVERY_CONFIRMED_BRANCH_LOCKED:
      'تسليم هذه الشحنة مؤكَّد بالإيصال، وقد اختير البنك الذي تُحتسب عليه تكلفة النقل من فرعيها. ألغِ التأكيد في «الشحنات المسلَّمة» أولًا، ثم غيِّر «من فرع» أو «إلى فرع».',
    OPERATIONS_SEAL_HELD_IN_VAULT:
      'أحد أختام هذا الاستلام ما زال في الخزينة على محصنة أخرى، ولا يُستلم مجددًا إلا بعد خروجها منها.',
    OPERATIONS_CREW_DAY_MISMATCH:
      'هذا الطاقم ليس مخططًا في يوم تسليم هذه الشحنة — اختر أحد أطقم ذلك اليوم.',
    OPERATIONS_CREW_CAPTAIN_MISMATCH: 'لم يعد هذا القائد ضمن طاقم المركبة المختارة.',
    OPERATIONS_DELIVERY_LEG_REQUIRED: 'إحدى الشحنات بلا طاقم تسليم بعد — عيّن طاقمها قبل صرفها.',
    OPERATIONS_DISTRIBUTION_DAY_IN_PAST:
      'هذا اليوم قد مضى وغادرت سياراته، وسجله للعرض فقط — وزّع على اليوم أو على يوم بعده.',
    OPERATIONS_DISTRIBUTION_ALREADY_DISPATCHED:
      'إحدى المحصنات في هذه الشاشة غادرت الخزينة بالفعل، فلم يعد وضعها على سيارة ممكنًا.',
    OPERATIONS_DISTRIBUTION_NOT_ON_DAY:
      'إحدى المحصنات ليست مستحقة التسليم في هذا اليوم، فلا يمكن وضعها على سيارات هذا اليوم.',
    OPERATIONS_DISTRIBUTION_LEG_STARTED:
      'بدأ قائدها هذا التسليم من التطبيق، فلم يعد نقلها أو إزالتها من سيارته ممكنًا.',
    OPERATIONS_DISTRIBUTION_ROW_NOT_SECURED:
      'هذا الصف ليس من نوع محصنة، فلا يأخذ محصنات جديدة — اختر صفًا من نوع محصنة.',
    OPERATIONS_DISPATCH_NOT_TODAY:
      'التسليم يتم يوم خروج السيارة فقط — هذه السيارة ليست من سيارات اليوم.',
    OPERATIONS_UNKNOWN_SHIFT_TYPE:
      'أُعطي أحد الصفوف نوعًا لم يعد مفعّلًا في البيانات المرجعية — اختر نوعًا آخر في الصف المُعلَّم.',
    OPERATIONS_DIRECTION_NOT_AN_AREA:
      'أحد الاتجاهات ليس من المناطق المسجلة في البيانات المرجعية — ما زال الخادم يرفض الاتجاه المكتوب يدويًا.',
    OPERATIONS_CREW_MEMBER_ABSENT: 'على أحد الصفوف غائب أو من في إجازة في هذا اليوم.',
    OPERATIONS_CREW_MEMBER_WRONG_SLOT:
      'عُيِّن أحدهم في خانة لا تناسبه — قائد في خانة أخصائي، أو أخصائي في خانة القائد.',
    OPERATIONS_CREW_VEHICLE_NOT_ACTIVE:
      'السيارة المعطاة للصف المُعلَّم ليست في الخدمة في الأسطول — اختر سيارة أخرى.',
    OPERATIONS_CREW_VEHICLE_IN_WORKSHOP:
      'السيارة المعطاة للصف المُعلَّم في الصيانة في هذا اليوم — اختر سيارة أخرى.',
    OPERATIONS_CREW_VEHICLE_TAKEN:
      'السيارة المعطاة للصف المُعلَّم عليها طاقم آخر في هذا اليوم — اختر سيارة أخرى.',
    OPERATIONS_CREW_ROW_HAS_SHIPMENTS:
      'على صف محذوف محصنات. ما دامت في الخزينة فأزِلها عنه في «توزيع المحصنات» أولًا؛ وإن كانت قد خرجت من الخزينة فيبقى الصف، ويمكن تفريغه أو إعطاؤه سيارة.',
    OPERATIONS_CREW_DAY_IN_PAST:
      'هذا اليوم قد مضى — لوحته سجل للعرض فقط. خطِّط لليوم أو ليوم لاحق.',
    ATM_MAIL_POLL_BUSY: 'تجري الآن قراءة للبريد — ستظهر نتيجتها في «آخر قراءة» بعد لحظات.',
    IT_CONSUMABLE_COUNTER_REQUIRED:
      'هذا الصنف يتطلب عداد الطابعة: حدِّد الطابعة التي يُركَّب عليها وقراءة عدادها، حبارة واحدة في كل سطر.',
    IT_CONSUMABLE_COUNTER_BELOW_PREVIOUS:
      'قراءة العداد يجب أن تكون أكبر من آخر قراءة مسجّلة لهذه الطابعة — وإذا صُفِّر عدادها فحدِّد «تم تصفير عداد الطابعة».',
    IT_CONSUMABLE_COUNTER_ABOVE_NEXT:
      'تاريخ هذه القراءة سابق لقراءة لاحقة مسجّلة للطابعة نفسها، فيجب أن تكون أقل منها.',
    ADMINISTRATION_DUPLICATE:
      'هذا الاسم أو الكود أو الباركود مسجَّل لسجل آخر، نشطًا كان أو موقوفًا — والموقوف يُعاد تفعيله ولا يُضاف مرة أخرى.',
    ADMINISTRATION_CATEGORY_PARENT_INVALID:
      'لا يمكن وضع هذا التصنيف تحت ذلك التصنيف: للتصنيفات مستويان، والتصنيف الذي له تصنيفات فرعية يبقى رئيسيًا.',
    ADMINISTRATION_STOCK_LEVELS_ORDER:
      'حدود المخزون غير مرتبة: عند تحديدها يكون الحد الأدنى ≤ حد إعادة الطلب ≤ الحد الأقصى.',
    ADMINISTRATION_REFERENCE_INACTIVE:
      'وحدة أو تصنيف مما اخترته موقوف، فلا يُسنَد إلى أي سجل من جديد — اختر بديلًا نشطًا.',
    ADMINISTRATION_SUBCATEGORY_REQUIRED: 'للتصنيف المختار تصنيفات فرعية — أدرج الصنف تحت أحدها.',
    ADMINISTRATION_EMPLOYEE_EXITED:
      'ترك أمين المخزن المختار العمل — اختر أحدًا ممن يعملون لدينا اليوم.',
    ADMINISTRATION_DEACTIVATION_BLOCKED:
      'لا يمكن إيقاف هذا المخزن ما دام فيه رصيد أو يشير إليه مستند لم يُغلق بعد.',
    ADMINISTRATION_ATTACHMENT_LIMIT:
      'تضم هذه القائمة عشرين مستندًا، وهو أقصى ما تتسع له — أزِل أحدها قبل إضافة غيره.',
    RATE_LIMITED: 'طلبات كثيرة جدًا — يُرجى التمهّل.',
    FILE_TYPE_NOT_ALLOWED: 'هذا النوع من الملفات غير مقبول هنا.',
    FILE_TOO_LARGE: 'هذا الملف كبير جدًا.',
    PAYLOAD_TOO_LARGE: 'حجم البيانات المُرسَلة أكبر من أن تُحفظ دفعة واحدة.',
    FILE_BLOCKED: 'حظر فاحص الفيروسات هذا الملف.',
    FILE_SCAN_PENDING: 'ما زال هذا الملف قيد فحص الفيروسات — حاول مجددًا بعد لحظات.',
    INTERNAL: 'تعذّر على الخادم إتمام هذا الطلب.',
    AUTH_TOKEN_EXPIRED: 'انتهت جلستك — يُرجى تسجيل الدخول مجددًا.',
    AUTH_TOKEN_INVALID: 'لم تعد جلستك صالحة — يُرجى تسجيل الدخول مجددًا.',
    UNAUTHENTICATED: 'انتهت جلستك — يُرجى تسجيل الدخول مجددًا.',
    AUTH_SESSION_REVOKED: 'تم إنهاء هذه الجلسة — يُرجى تسجيل الدخول مجددًا.',
    NETWORK: 'خطأ في الشبكة — تحقق من اتصالك.',
    UNKNOWN: 'حدث خطأ ما. يُرجى المحاولة مجددًا.',
  },
};

/**
 * Is there actually a thrown value here?
 *
 * TanStack Query reports "this query has not failed" as `error: null`, never `undefined`. A
 * presence test written as `error !== undefined` therefore calls every SUCCESSFUL query a
 * failure. That is not hypothetical: it is why eleven Operations screens drew the generic
 * "something went wrong" panel on top of a perfectly good — and in the reported case, empty —
 * result set, while the requests behind them all returned 200.
 *
 * Both absent forms mean the same thing. This is the one place that says so, so that passing a
 * query's `error` straight into a component is correct rather than a trap the caller has to know
 * to work around.
 */
export const hasError = (error: unknown): boolean => error !== undefined && error !== null;

/**
 * Round 28c critic — «المناطق» refuses a name another area already holds in any spelling (folded:
 * «المعادى» beside «المعادي», an archived one too), and names that area in its detail
 * (`AREA_ACTIVE` / `AREA_ARCHIVED`). Wherever it surfaces — the catalog's own dialog among them —
 * it is said in the reader's language, naming the area, not as the server's English sentence.
 */
const AREA_HELD: Record<Locale, { active: string; archived: string }> = {
  en: {
    active: '«Areas» already has “{area}” under this name.',
    archived:
      '«Areas» has “{area}” under this name, but archived — restore it instead of adding it again.',
  },
  ar: {
    active: 'في «المناطق» منطقة «{area}» بهذا الاسم.',
    archived: 'في «المناطق» منطقة «{area}» بهذا الاسم لكنها موقوفة — فعّلها بدل إضافتها مرة أخرى.',
  },
};

const areaHeldMessage = (error: ApiError, locale: Locale): string | null => {
  if (error.code !== 'DUPLICATE') return null;
  const held = error.details?.find(
    (detail) => detail.code === 'AREA_ACTIVE' || detail.code === 'AREA_ARCHIVED',
  );
  if (held === undefined || held.message === '') return null;
  const words = AREA_HELD[locale][held.code === 'AREA_ARCHIVED' ? 'archived' : 'active'];
  return words.replace('{area}', held.message);
};

export const errorMessage = (error: unknown, locale: Locale): string => {
  const table = FRIENDLY[locale];
  if (error instanceof ApiError) {
    const held = areaHeldMessage(error, locale);
    if (held !== null) return held;
    return table[error.code] ?? (error.message !== '' ? error.message : (table.UNKNOWN ?? 'Error'));
  }
  if (error instanceof TypeError) return table.NETWORK ?? 'Network error';
  if (error instanceof Error && error.message !== '') return error.message;
  return table.UNKNOWN ?? 'Error';
};

/** Field-level validation details, when the server returned a VALIDATION_ERROR envelope. */
export const validationDetails = (error: unknown): { field?: string; message: string }[] =>
  error instanceof ApiError && error.details !== undefined ? error.details : [];

/**
 * The technical identity of a failure: the server's error code and the id it filed the request
 * under (`ApiFailure.requestId`, also on the `X-Request-Id` header).
 *
 * Friendly copy is for the person; this is for whoever has to find out what happened. A failure a
 * user can only describe as "something went wrong" is a failure nobody can look up, and the API
 * has been minting a correlation id for every one of them that the client never read.
 *
 * Returns `null` when the value carries no server identity — a network drop or a client-side
 * throw has nothing to correlate, and an empty reference is worse than none.
 */
export const errorDiagnostic = (error: unknown): { code: string; requestId?: string } | null => {
  if (!(error instanceof ApiError)) return null;
  const { code, requestId } = error;
  return requestId === undefined || requestId === '' ? { code } : { code, requestId };
};
