// The Readers site: a home page and one page per document type (#/national-id, #/egycash-id,
// #/army-exemption), each in its own theme. Each reader reads on its own job (POST /jobs) and follows
// it live (GET /jobs/<id>/events). A read keeps going when you switch page, and the three can run at
// the same time; the service reads them on separate worker processes (see src/nidocr/pool.py).
//
// States, on each panel's data-state: idle → reading → match | invalid | unreadable | failed.
// `invalid` is the verdict not_match and switches the panel to the invalid theme with a message in
// Arabic and English (role="alert"). Nothing is stored: the photos stay in this page's memory.

import { mountHero, heroStateChanged } from "./heroes.js";

// Arabic strings are drafts, to be reviewed by a native speaker before release.
const T = {
  en: {
    skip: "Skip to content", title: "Document readers",
    navNid: "National ID Card", navEgyid: "EGY CASH ID", navArmy: "Army Exemption",
    homeEyebrow: "EGY CASH · Document readers", homeTitle: "Read a document in seconds. Check it before it counts.",
    homeLead: "Three readers, each on its own page: the National ID Card, the EGY CASH ID and the Army Exemption Certificate. Everything runs on this computer. Nothing is saved until a person confirms it.",
    ctaNid: "Read a National ID Card", ctaEgyid: "Read an EGY CASH ID", chooseTitle: "Choose a reader",
    nidBlurb: "Front and back. Name, number, address, dates and the back's details.",
    egyidBlurb: "The company badge. Name, job title and employee code.",
    armyBlurb: "Format and consistency checks only. Only the issuing authority can confirm a certificate.",
    step1t: "Add the photos", step1: "Take them with the phone, upload saved ones, or drop them in. They stay in this page.",
    step2t: "Read", step2: "The reader checks it is the right document first, then reads each field.",
    step3t: "Check every value", step3: "Each value shows how sure the reader is. A person confirms before anything is saved.",
    resultTitle: "The result appears here", resultHint: "Each value comes with how sure the reader is. Check every one before using it.",
    detail: "Technical detail", asRead: "The card as read", portraitTitle: "Photo from the card", portraitHint: "Cut from the front, as printed.",
    downloadPhoto: "Download photo", download: "Download", sideFront: "Front", sideBack: "Back", serviceUp: "Reader service online", serviceDown: "Reader service offline", serviceUnknown: "Checking the service…",
    serviceDownMsg: "The reading service is not running on this computer. Start it (docker compose up -d in national-id-ocr), then press Read again.",
    pages: {
      national_id: { eyebrow: "Reader 01 · Egypt", lead: "Add the front and the back. The reader checks it is a National ID Card, reads every field, and cross-checks the 14-digit number against the birth date and sex printed on the card.",
        facts: ["Front + back", "14-digit number checked", "Offline", "A person confirms"] },
      egycash_id: { eyebrow: "Reader 02 · EGY CASH", lead: "Add the badge. The reader looks for the company's name and logo first, then reads the holder's name, job title and employee code.",
        facts: ["One photo", "Company mark checked", "Offline", "A person confirms"] },
      army_exemption: { eyebrow: "Reader 03 · Certificate", lead: "Add the certificate. The reader checks its format and that it agrees with the National ID Card. Only the issuing authority can confirm a certificate.",
        facts: ["One photo", "Format and consistency only", "Offline", "A person confirms"] },
    },
    subtitle: "Three readers, running at the same time. Nothing is saved: every value is checked by a person before it is used.",
    readAll: "Read all three", read: "Read", reset: "Clear", colorToggle: "Switch light or dark",
    footer: "Matching a format is not proof a document is genuine. Only the issuing authority can confirm that.",
    front: "Front photo", back: "Back photo", photo: "Photo", dropHint: "Flat, in good light, all four corners in view.",
    takePhoto: "Take photo", uploadPhoto: "Upload", retakePhoto: "Retake", replacePhoto: "Replace",
    photoAdded: "Added", dragHint: "or drag a photo here",
    states: { idle: "Ready", reading: "Reading", match: "Match", invalid: "Not this document", unreadable: "Could not read", failed: "Failed" },
    status: {
      idle: "Add a photo, then Read.", needPhoto: "Add a photo first.", reading: "Reading…",
      match: "Read in {s}. Check every value before using it.", invalid: "This is a different document.",
      unreadable: "Could not be confirmed. See why below.", failed: "The read did not finish: {e}",
    },
    verdict: {
      national_id: "Looks like a National ID Card.", egycash_id: "Looks like an EGY CASH ID.",
      army_exemption: "Matches the expected certificate format.",
    },
    armyNote: "Format and consistency only. Could not be confirmed as genuine: check with the issuing authority.",
    unreadableTitle: "Could not be confirmed", failedTitle: "The read failed",
    bands: { high: "High", medium: "Check", low: "Low" },
    fields: {
      fullNameAr: "Name", nationalId: "National ID number", address: "Address", occupation: "Occupation",
      religion: "Religion", maritalStatus: "Marital status", gender: "Sex", nationalIdExpiry: "Valid until",
      expiryDate: "Valid until", companyName: "Company", jobTitle: "Job title", employeeCode: "Employee code",
      certificateNumber: "Certificate number", issueDate: "Issue date", exemptionCategory: "Exemption category",
      issuingOffice: "Issuing office", birthDate: "Date of birth", militaryNumber: "Military number (year / markaz / serial)",
      decisionCode: "Decision code", decisionNumber: "Decision number", decisionDate: "Decision date",
      decision: "Decision", exemptionType: "Type of exemption",
      militaryIssuer: "Military card issued at", nationalIdIssuer: "National ID issued at",
      recruitmentArea: "Recruitment area", decisionReason: "Reason, in short", legalClause: "Article 7, part",
    },
    moreDetails: "More from the certificate",
    checksAgree: "Its details agree with each other.",
    checksFail: "Its details contradict each other:",
    checksLook: "Look at:",
    confirmLine: "Only the recruitment department can confirm it: tagned.mod.gov.eg, exemption certificate inquiry.",
    softChecks: {
      military_year_disagrees_with_birth: "the military number does not start with the birth year",
      area_disagrees_with_national_id: "the recruitment area is not the national ID's governorate",
    },
    reasons: {
      no_card_structure: "the card's own printed title and markings were not found",
      no_14_digit_number: "no 14-digit national ID number could be read",
      back_shown_for_front: "this looks like the back; the front was expected",
      front_shown_for_back: "this looks like the front; the back was expected",
      too_blurred: "the photo is blurred", too_small: "the document is too small in the photo",
      glare: "glare covers part of it", low_contrast: "the photo is too dark or flat", no_text: "no text was found",
      looks_like_egycash_id: "it looks like an EGY CASH ID", looks_like_national_id: "it looks like a National ID Card",
      company_name_missing: "the company name or logo was not found", employee_code_invalid: "no valid employee code was found",
      national_id_invalid: "the national ID number is not a possible one",
      reader_not_configured: "this reader is waiting for sample certificates and cannot judge yet",
      no_certificate_structure: "the certificate's title and labels were not found",
      date_implausible: "a date on it is not plausible",
      national_id_disagrees_with_card: "its ID number differs from the National ID Card's",
      name_disagrees_with_card: "its name differs from the National ID Card's",
      birth_date_disagrees_with_national_id: "the birth date differs from the one inside the national ID number",
      dates_out_of_order: "its dates are in an impossible order",
      fullNameAr_unclear: "the name could not be read clearly: take a sharper photo",
      nationalId_unclear: "the national ID number could not be read clearly: take a sharper photo",
      fullNameAr_missing: "the name was not found", nationalId_missing: "the national ID number was not found",
      type_disagrees_with_clause: "the type in its title (final or temporary) contradicts the article part it cites",
      type_disagrees_with_decision: "the type in its title contradicts the decision's own wording",
      reason_disagrees_with_type: "the reason given is not one the law gives this type of exemption for",
    },
  },
  ar: {
    skip: "انتقل إلى المحتوى", title: "قارئات المستندات",
    navNid: "بطاقة الرقم القومي", navEgyid: "EGY CASH ID", navArmy: "الإعفاء من التجنيد",
    homeEyebrow: "EGY CASH · قارئات المستندات", homeTitle: "اقرأ المستند في ثوانٍ، وراجعه قبل اعتماده.",
    homeLead: "ثلاث قارئات، لكل منها صفحتها: بطاقة الرقم القومي، وبطاقة EGY CASH ID، وشهادة الإعفاء من الخدمة العسكرية. كل شيء يعمل على هذا الجهاز، ولا يُحفظ شيء قبل أن يؤكده شخص.",
    ctaNid: "اقرأ بطاقة رقم قومي", ctaEgyid: "اقرأ بطاقة EGY CASH ID", chooseTitle: "اختر القارئة",
    nidBlurb: "الوجه والظهر: الاسم والرقم والعنوان والتواريخ وبيانات الظهر.",
    egyidBlurb: "بطاقة الشركة: الاسم والوظيفة وكود الموظف.",
    armyBlurb: "فحص الشكل والاتساق فقط. الجهة المُصدِرة وحدها تستطيع تأكيد الشهادة.",
    step1t: "أضف الصور", step1: "صوّرها بالهاتف أو أفلتها هنا. تبقى داخل هذه الصفحة.",
    step2t: "اقرأ", step2: "تتأكد القارئة أولاً أنه المستند الصحيح، ثم تقرأ كل حقل.",
    step3t: "راجع كل قيمة", step3: "تظهر مع كل قيمة درجة ثقة القارئة. يؤكد شخص قبل حفظ أي شيء.",
    resultTitle: "تظهر النتيجة هنا", resultHint: "تأتي كل قيمة مع درجة ثقة القارئة. راجعها كلها قبل استخدامها.",
    detail: "تفاصيل تقنية", asRead: "البطاقة كما قُرئت", portraitTitle: "الصورة من البطاقة", portraitHint: "مقصوصة من وجه البطاقة كما طُبعت.",
    downloadPhoto: "تنزيل الصورة", download: "تنزيل", sideFront: "الوجه", sideBack: "الظهر", serviceUp: "خدمة القراءة تعمل", serviceDown: "خدمة القراءة متوقفة", serviceUnknown: "جارٍ فحص الخدمة…",
    serviceDownMsg: "خدمة القراءة لا تعمل على هذا الجهاز. شغّلها بالأمر ⁦docker compose up -d⁩ داخل مجلد ⁦national-id-ocr⁩، ثم اضغط اقرأ مرة أخرى.",
    pages: {
      national_id: { eyebrow: "القارئة 01 · مصر", lead: "أضف الوجه والظهر. تتأكد القارئة أنها بطاقة رقم قومي، وتقرأ كل الحقول، وتطابق الرقم القومي مع تاريخ الميلاد والنوع المطبوعين.",
        facts: ["الوجه + الظهر", "فحص الرقم من 14 خانة", "بدون إنترنت", "يؤكد شخص"] },
      egycash_id: { eyebrow: "القارئة 02 · EGY CASH", lead: "أضف البطاقة. تبحث القارئة أولاً عن اسم الشركة وشعارها، ثم تقرأ اسم حاملها ووظيفته وكود الموظف.",
        facts: ["صورة واحدة", "فحص شعار الشركة", "بدون إنترنت", "يؤكد شخص"] },
      army_exemption: { eyebrow: "القارئة 03 · شهادة", lead: "أضف الشهادة. تفحص القارئة شكلها واتفاقها مع بطاقة الرقم القومي، والجهة المُصدِرة وحدها تستطيع تأكيد الشهادة.",
        facts: ["صورة واحدة", "الشكل والاتساق فقط", "بدون إنترنت", "يؤكد شخص"] },
    },
    subtitle: "ثلاث قارئات تعمل في الوقت نفسه. لا يُحفظ شيء: يراجع شخصٌ كل قيمة قبل استخدامها.",
    readAll: "اقرأ الثلاثة", read: "اقرأ", reset: "مسح", colorToggle: "تبديل الوضع الفاتح أو الداكن",
    footer: "مطابقة الشكل ليست دليلاً على صحة المستند. الجهة المُصدِرة وحدها تستطيع تأكيد ذلك.",
    front: "صورة الوجه", back: "صورة الظهر", photo: "الصورة", dropHint: "مسطّحة، في إضاءة جيدة، وزواياها الأربع ظاهرة.",
    takePhoto: "التقاط صورة", uploadPhoto: "رفع صورة", retakePhoto: "إعادة التصوير", replacePhoto: "تغيير",
    photoAdded: "تمت الإضافة", dragHint: "أو اسحب الصورة إلى هنا",
    states: { idle: "جاهز", reading: "جارٍ القراءة", match: "مطابق", invalid: "ليس هذا المستند", unreadable: "تعذّرت القراءة", failed: "فشل" },
    status: {
      idle: "أضف صورة ثم اضغط اقرأ.", needPhoto: "أضف صورة أولاً.", reading: "جارٍ القراءة…",
      match: "تمت القراءة في {s}. راجع كل قيمة قبل استخدامها.", invalid: "هذا مستند مختلف.",
      unreadable: "تعذّر التأكيد. السبب بالأسفل.", failed: "لم تكتمل القراءة: {e}",
    },
    verdict: {
      national_id: "تبدو بطاقة رقم قومي.", egycash_id: "تبدو بطاقة EGY CASH ID.",
      army_exemption: "يطابق الشكل المتوقع للشهادة.",
    },
    armyNote: "الشكل والاتساق فقط. تعذّر تأكيد صحتها: راجع الجهة المُصدِرة.",
    unreadableTitle: "تعذّر التأكيد", failedTitle: "فشلت القراءة",
    bands: { high: "عالية", medium: "راجع", low: "منخفضة" },
    fields: {
      fullNameAr: "الاسم", nationalId: "الرقم القومي", address: "العنوان", occupation: "المهنة",
      religion: "الديانة", maritalStatus: "الحالة الاجتماعية", gender: "النوع", nationalIdExpiry: "سارية حتى",
      expiryDate: "سارية حتى", companyName: "الشركة", jobTitle: "الوظيفة", employeeCode: "كود الموظف",
      certificateNumber: "رقم الشهادة", issueDate: "تاريخ الإصدار", exemptionCategory: "فئة الإعفاء",
      issuingOffice: "جهة الإصدار", birthDate: "تاريخ الميلاد", militaryNumber: "الرقم الثلاثي (السنة / المركز / المسلسل)",
      decisionCode: "كود القرار", decisionNumber: "رقم القرار", decisionDate: "تاريخ القرار",
      decision: "القرار", exemptionType: "نوع الإعفاء",
      militaryIssuer: "جهة صدور البطاقة العسكرية", nationalIdIssuer: "جهة صدور الرقم القومي",
      recruitmentArea: "منطقة التجنيد", decisionReason: "سبب الإعفاء باختصار", legalClause: "بند المادة السابعة",
    },
    moreDetails: "باقي بيانات الشهادة",
    checksAgree: "بياناتها متسقة مع بعضها.",
    checksFail: "بياناتها تتعارض:",
    checksLook: "راجع:",
    confirmLine: "التأكيد من إدارة التجنيد فقط: tagned.mod.gov.eg، الاستعلام عن شهادة الإعفاء.",
    softChecks: {
      military_year_disagrees_with_birth: "الرقم العسكري لا يبدأ بسنة الميلاد",
      area_disagrees_with_national_id: "منطقة التجنيد ليست محافظة الرقم القومي",
    },
    reasons: {
      no_card_structure: "لم يُعثر على عنوان البطاقة وعلاماتها المطبوعة",
      no_14_digit_number: "تعذّرت قراءة رقم قومي من 14 رقماً",
      back_shown_for_front: "يبدو أن هذا ظهر البطاقة، والمطلوب الوجه",
      front_shown_for_back: "يبدو أن هذا وجه البطاقة، والمطلوب الظهر",
      too_blurred: "الصورة غير واضحة", too_small: "المستند صغير جداً في الصورة",
      glare: "يوجد انعكاس ضوء على جزء منه", low_contrast: "الصورة مظلمة أو باهتة", no_text: "لم يُعثر على نص",
      looks_like_egycash_id: "يبدو أنها بطاقة EGY CASH ID", looks_like_national_id: "يبدو أنها بطاقة رقم قومي",
      company_name_missing: "لم يُعثر على اسم الشركة أو شعارها", employee_code_invalid: "لم يُعثر على كود موظف صحيح",
      national_id_invalid: "الرقم القومي غير ممكن",
      reader_not_configured: "هذه القارئة بانتظار نماذج من الشهادات ولا تستطيع الحكم بعد",
      no_certificate_structure: "لم يُعثر على عنوان الشهادة وحقولها",
      date_implausible: "أحد التواريخ غير منطقي",
      national_id_disagrees_with_card: "الرقم القومي يختلف عن بطاقة الرقم القومي",
      name_disagrees_with_card: "الاسم يختلف عن بطاقة الرقم القومي",
      birth_date_disagrees_with_national_id: "تاريخ الميلاد يختلف عن التاريخ داخل الرقم القومي",
      dates_out_of_order: "تواريخها في ترتيب مستحيل",
      fullNameAr_unclear: "تعذّرت قراءة الاسم بوضوح: التقط صورة أوضح",
      nationalId_unclear: "تعذّرت قراءة الرقم القومي بوضوح: التقط صورة أوضح",
      fullNameAr_missing: "لم يُعثر على الاسم", nationalId_missing: "لم يُعثر على الرقم القومي",
      type_disagrees_with_clause: "نوع الإعفاء في العنوان يخالف بند المادة المذكور",
      type_disagrees_with_decision: "نوع الإعفاء في العنوان يخالف نص القرار",
      reason_disagrees_with_type: "السبب المذكور لا يمنح القانون عليه هذا النوع من الإعفاء",
    },
  },
};

// Used until GET /types answers (or if it cannot): the same three, from registry.py.
const FALLBACK_TYPES = [
  { id: "national_id", label: { en: "National ID Card", ar: "بطاقة الرقم القومي" }, themeId: "nid", sides: ["front", "back"],
    invalidMessage: { en: "This does not look like a National ID Card.", ar: "هذه لا تبدو بطاقة رقم قومي." } },
  { id: "egycash_id", label: { en: "EGY CASH ID", ar: "بطاقة EGY CASH ID" }, themeId: "egyid", sides: ["front"],
    invalidMessage: { en: "This is not an EGY CASH ID.", ar: "هذه ليست بطاقة EGY CASH ID." } },
  { id: "army_exemption", label: { en: "Army Exemption Certificate", ar: "شهادة الإعفاء من الخدمة العسكرية" }, themeId: "army", sides: ["front"],
    invalidMessage: { en: "This does not look like an Army Exemption Certificate.", ar: "هذه لا تبدو شهادة إعفاء من الخدمة العسكرية." } },
];

const ICONS = {
  idle: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/>',
  reading: '<circle cx="12" cy="12" r="5" fill="currentColor"/>',
  match: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  invalid: '<path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>',
  unreadable: '<path d="M12 7v6M12 16.5v.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>',
  failed: '<path d="M12 3 2 21h20L12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
};
// Fields in the order a person reads the document, whatever order the reader found them in.
const FIELD_ORDER = ["companyName", "fullNameAr", "exemptionType", "legalClause", "birthDate", "militaryNumber",
  "militaryIssuer", "nationalId", "nationalIdIssuer", "decisionCode", "decisionNumber", "decisionDate",
  "decisionReason", "decision", "issueDate", "recruitmentArea", "jobTitle", "employeeCode",
  "address", "occupation", "gender", "religion", "maritalStatus", "nationalIdExpiry", "expiryDate"];
// What HR needs at a glance on each document; the rest of what was read is folded under "More".
const MAIN_FIELDS = {
  army_exemption: ["fullNameAr", "nationalId", "birthDate", "exemptionType", "decisionReason", "militaryNumber",
    "decisionNumber", "decisionDate", "issueDate"],
};
const EXEMPTION_TYPE_EN = { "نهائي": "Final", "مؤقت": "Temporary" };
const fieldRank = (name) => { const i = FIELD_ORDER.indexOf(name); return i < 0 ? FIELD_ORDER.length : i; };
const BAND_ICON = { high: "●", medium: "◐", low: "○" };
const MAX_SIDE = 4000;

let lang = "en";
try { lang = localStorage.getItem("readers.lang") || "en"; } catch { /* storage may be blocked */ }
const t = () => T[lang];
const panels = [];

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? "");
}

// Routes: the hash names the page. Each reader's page keeps its state when you leave it.
const ROUTES = { "national-id": "national_id", "egycash-id": "egycash_id", "army-exemption": "army_exemption" };
const ROUTE_OF = Object.fromEntries(Object.entries(ROUTES).map(([route, id]) => [id, route]));
const THEME_OF = { national_id: "nid", egycash_id: "egyid", army_exemption: "army" };

/** A read that could not reach the service at all: say so plainly, keep the raw text as detail. */
function isServiceDown(message) {
  return /did not answer|refused|ECONNREFUSED|Failed to fetch|NetworkError|HTTP 50[234]|lost the connection|service_unreachable/i.test(message || "");
}

function applyLanguage() {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  for (const node of document.querySelectorAll("[data-i18n]")) {
    const text = t()[node.dataset.i18n];
    if (typeof text === "string") node.textContent = text;
  }
  for (const node of document.querySelectorAll("[data-i18n-aria]")) node.setAttribute("aria-label", t()[node.dataset.i18nAria]);
  const toggle = document.getElementById("lang");
  toggle.textContent = lang === "ar" ? "EN" : "ع";
  toggle.setAttribute("aria-label", lang === "ar" ? "English" : "العربية");
  toggle.lang = lang === "ar" ? "en" : "ar";
  for (const panel of panels) { renderPage(panel); render(panel); }
  renderService();
}

let serviceUp = "unknown";
function renderService() {
  const node = document.getElementById("service");
  node.dataset.up = serviceUp;
  node.querySelector(".service-text").textContent = serviceUp === "yes" ? t().serviceUp : serviceUp === "no" ? t().serviceDown : t().serviceUnknown;
}

async function checkService() {
  try {
    const response = await fetch("/types", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(2500) });
    serviceUp = response.ok ? "yes" : "no";
    if (response.ok) {
      const served = (await response.json()).types || [];
      for (const type of served) {
        const panel = panels.find((item) => item.type.id === type.id);
        if (panel) { panel.type = { ...panel.type, ...type }; renderPage(panel); render(panel); }
      }
    }
  } catch {
    serviceUp = "no";
  }
  renderService();
}

/** A photo → base64 JPEG, its long side capped so a phone photo is never sent at 50 MP. */
async function encode(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function setState(panel, state, extra = {}) {
  Object.assign(panel, { state }, extra);
  // The page, its reader and its nav link all carry the state: the hero, the invalid theme and the
  // nav dot follow it.
  panel.page.dataset.state = state;
  panel.el.dataset.state = state;
  document.querySelector(`[data-nav="${panel.type.id}"]`)?.setAttribute("data-state", state);
  const alert = panel.el.querySelector(".alert");
  if (state === "invalid") {
    alert.classList.remove("shake-once");
    void alert.offsetWidth; // restart the one shake
    alert.classList.add("shake-once");
  }
  if (state === "failed" && isServiceDown(panel.error)) { serviceUp = "no"; renderService(); }
  if (["match", "invalid", "unreadable"].includes(state)) { serviceUp = "yes"; renderService(); }
  heroStateChanged();
  render(panel);
}

function renderPage(panel) {
  const { page, type } = panel;
  const copy = t().pages[type.id];
  page.querySelector(".eyebrow").textContent = copy.eyebrow;
  page.querySelector(".page-title").textContent = type.label[lang] || type.label.en;
  page.querySelector(".lead").textContent = copy.lead;
  const facts = page.querySelector(".facts");
  facts.innerHTML = "";
  for (const fact of copy.facts) { const li = document.createElement("li"); li.textContent = fact; facts.append(li); }
}

function render(panel) {
  const { el, type, state } = panel;
  const strings = t();
  const name = el.querySelector(".name");
  name.textContent = type.label[lang] || type.label.en;
  el.querySelector(".chip.state .icon").innerHTML = ICONS[state] || ICONS.idle;
  el.querySelector(".state-text").textContent = strings.states[state];
  for (const drop of el.querySelectorAll(".drop")) {
    const side = drop.dataset.side;
    const label = type.sides.length > 1 ? strings[side] : strings.photo;
    drop.querySelector(".drop-label").textContent = label;
    drop.querySelector(".drop-hint").textContent = strings.dropHint;
    drop.querySelector('[data-pick="camera"]').setAttribute("aria-label", `${strings.takePhoto}: ${label}`);
    drop.querySelector('[data-pick="upload"]').setAttribute("aria-label", `${strings.uploadPhoto}: ${label}`);
  }

  if (state !== "reading") {
    el.querySelector(".timer").textContent = panel.elapsedMs != null ? `${(panel.elapsedMs / 1000).toFixed(1)} s` : "";
  }
  const down = state === "failed" && isServiceDown(panel.error);
  const status = el.querySelector(".status");
  const seconds = panel.elapsedMs != null ? `${(panel.elapsedMs / 1000).toFixed(1)} s` : "";
  status.textContent = state === "idle" && panel.needPhoto ? strings.status.needPhoto
    : down ? strings.serviceDown
      : fill(strings.status[state] || "", { s: seconds, e: panel.error || "" });

  const result = panel.result;
  const verdict = result?.verdict;
  const reasons = (verdict?.reasons || []).map((code) => strings.reasons[code] || code);

  const alert = el.querySelector(".alert");
  alert.hidden = !["invalid", "unreadable", "failed"].includes(state);
  if (!alert.hidden) {
    const en = alert.querySelector(".msg-en");
    const ar = alert.querySelector(".msg-ar");
    if (state === "invalid") {
      en.textContent = type.invalidMessage.en;
      ar.textContent = type.invalidMessage.ar;
    } else {
      en.textContent = state === "failed" ? T.en.failedTitle : T.en.unreadableTitle;
      ar.textContent = state === "failed" ? T.ar.failedTitle : T.ar.unreadableTitle;
    }
    // The page's language first.
    if (lang === "ar") alert.querySelector("div").prepend(ar); else alert.querySelector("div").prepend(en);
    alert.querySelector(".why").textContent = state === "failed" ? (down ? strings.serviceDownMsg : (panel.error || "")) : reasons.join(" · ");
    const detail = alert.querySelector(".detail");
    detail.hidden = !(down && panel.error);
    detail.querySelector("code").textContent = down ? panel.error : "";
  }

  renderImages(panel);
  el.querySelector(".skeletons").hidden = state !== "reading";
  const card = el.querySelector(".result-card");
  const fields = Object.entries(result?.fields || {}).sort(([a], [b]) => fieldRank(a) - fieldRank(b));
  card.hidden = !(state === "match" || (state === "unreadable" && fields.length));
  if (!card.hidden) {
    el.querySelector(".verdict-text").textContent = state === "match" ? strings.verdict[type.id] : strings.status.unreadable;
    const list = el.querySelector(".fields");
    list.innerHTML = "";
    const more = el.querySelector(".more");
    const moreList = more.querySelector(".more-fields");
    moreList.innerHTML = "";
    const main = MAIN_FIELDS[type.id];
    more.hidden = !main || !fields.some(([name]) => !main.includes(name));
    if (main) fields.sort(([a], [b]) => (main.includes(a) ? main.indexOf(a) : 99) - (main.includes(b) ? main.indexOf(b) : 99));
    fields.forEach(([fieldName, data], i) => {
      const band = data.confidence in BAND_ICON ? data.confidence : "low";
      const score = result.scores?.[fieldName];
      const row = document.createElement("div");
      row.className = "field";
      row.style.setProperty("--i", String(i));
      const dt = document.createElement("dt");
      dt.textContent = strings.fields[fieldName] || fieldName;
      const dd = document.createElement("dd");
      dd.dir = "auto";
      // The reason's summary in the page's language; the decision itself is shown as printed.
      const reasonEn = result.diagnostics?.exemptionCheck?.decisionReason?.en;
      // The military number in the official form's order: birth year / markaz / serial (the paper
      // prints it right to left, so its year sits at the right end there).
      const military = fieldName === "militaryNumber" && /^\d{10}$/.test(data.value);
      if (military) dd.dir = "ltr";
      dd.textContent = military ? `${data.value.slice(0, 4)} / ${data.value.slice(4, 7)} / ${data.value.slice(7)}`
        : fieldName === "decisionReason" && lang === "en" && reasonEn ? reasonEn
        : fieldName === "exemptionType" && lang === "en" ? (EXEMPTION_TYPE_EN[data.value] || data.value) : data.value;
      const chip = document.createElement("span");
      chip.className = `band ${band}`;
      chip.textContent = `${BAND_ICON[band]} ${strings.bands[band]}${score != null ? ` ${score}%` : ""}`;
      row.append(dt, dd, chip);
      (main && !main.includes(fieldName) ? moreList : list).append(row);
    });
    el.querySelector(".note").textContent = "";
  }
  renderChecks(panel, card.hidden);
}

/** Army Exemption: one line on whether its details agree, one on how to confirm it. */
function renderChecks(panel, noResult) {
  const { el, result, type } = panel;
  const strings = t();
  const box = el.querySelector(".checks-card");
  const checks = result?.diagnostics?.exemptionCheck?.checks || [];
  box.hidden = type.id !== "army_exemption" || noResult || !checks.length;
  if (box.hidden) return;
  const failed = checks.filter((check) => check.result === "fail");
  const strong = failed.filter((check) => check.strong).map((check) => strings.reasons[check.reason] || check.reason);
  const soft = failed.filter((check) => !check.strong).map((check) => strings.softChecks[check.reason] || check.reason);
  const line = box.querySelector(".checks-line");
  line.className = `checks-line ${strong.length ? "fail" : soft.length ? "soft" : "pass"}`;
  line.textContent = [
    strong.length ? `✕ ${strings.checksFail} ${strong.join(lang === "ar" ? "، " : "; ")}.` : `✓ ${strings.checksAgree}`,
    soft.length ? `${strings.checksLook} ${soft.join(lang === "ar" ? "، " : "; ")}.` : "",
  ].filter(Boolean).join(" ");
  box.querySelector(".confirm-line").textContent = strings.confirmLine;
}

/** Each side as read, with its download, then the holder's photo with its own. */
function renderImages(panel) {
  const { el, result, state, type } = panel;
  const strings = t();
  const images = (state === "match" || state === "unreadable") ? (result?.orientedImages || {}) : {};
  const portrait = state === "match" ? result?.portraitImage : null;
  const box = el.querySelector(".as-read");
  const sides = ["front", "back"].filter((side) => images[side]);
  box.hidden = !sides.length && !portrait;
  if (box.hidden) return;
  const stem = ROUTE_OF[type.id];
  const host = box.querySelector(".sides");
  host.innerHTML = "";
  for (const side of sides) {
    const src = `data:image/jpeg;base64,${images[side]}`;
    const label = side === "front" ? strings.sideFront : strings.sideBack;
    const figure = document.createElement("figure");
    figure.className = "side";
    const img = document.createElement("img");
    img.src = src;
    img.alt = `${type.label[lang] || type.label.en}: ${label}`;
    const caption = document.createElement("figcaption");
    const name = document.createElement("span");
    name.textContent = label;
    const link = document.createElement("a");
    link.className = "btn ghost small";
    link.href = src;
    link.download = `${stem}-${side}.jpg`;
    link.textContent = strings.download;
    link.setAttribute("aria-label", `${strings.download}: ${label}`);
    caption.append(name, link);
    figure.append(img, caption);
    host.append(figure);
  }
  const row = box.querySelector(".portrait-row");
  row.hidden = !portrait;
  if (portrait) {
    const src = `data:image/jpeg;base64,${portrait}`;
    const img = row.querySelector(".portrait");
    img.src = src;
    img.alt = strings.portraitTitle;
    const link = row.querySelector(".portrait-dl");
    link.href = src;
    link.download = `${stem}-photo.jpg`;
  }
}

function tickTimer(panel) {
  const timer = panel.el.querySelector(".timer");
  const update = () => {
    if (panel.state !== "reading") {
      timer.textContent = panel.elapsedMs != null ? `${(panel.elapsedMs / 1000).toFixed(1)} s` : "";
      return;
    }
    timer.textContent = `${((performance.now() - panel.startedAt) / 1000).toFixed(1)} s`;
    requestAnimationFrame(update);
  };
  update();
}

function holderFromNationalId() {
  const nid = panels.find((panel) => panel.type.id === "national_id");
  const fields = nid?.state === "match" ? nid.result?.fields : null;
  if (!fields) return undefined;
  return { nationalId: fields.nationalId?.value, fullNameAr: fields.fullNameAr?.value };
}

async function read(panel) {
  if (panel.state === "reading") return;
  const files = panel.files;
  if (!files.front && !files.back) {
    panel.needPhoto = true;
    setState(panel, "idle");
    return;
  }
  panel.needPhoto = false;
  panel.result = null;
  panel.error = null;
  panel.elapsedMs = null;
  panel.startedAt = performance.now();
  setState(panel, "reading");
  tickTimer(panel);
  try {
    // Ask for each side as it was read (cut out and upright) and, on the National ID Card, the
    // holder's photo: shown and downloadable here, never stored by the service.
    const body = { documentType: panel.type.id, returnOrientedImages: true, returnPortrait: panel.type.id === "national_id" };
    if (files.front) body.frontImageBase64 = await encode(files.front);
    if (files.back) body.backImageBase64 = await encode(files.back);
    const holder = panel.type.id === "army_exemption" ? holderFromNationalId() : undefined;
    if (holder) body.holder = holder;
    const response = await fetch("/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const started = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(started.error || `HTTP ${response.status}`);
    await follow(panel, started.events);
  } catch (error) {
    panel.elapsedMs = performance.now() - panel.startedAt;
    setState(panel, "failed", { error: error.message || String(error) });
  }
}

/** Follow a job's events to its end. Falls back to polling if the stream breaks. */
function follow(panel, url) {
  return new Promise((resolve, reject) => {
    const source = new EventSource(url);
    const finish = (event) => {
      const job = JSON.parse(event.data);
      if (!job.done) return;
      source.close();
      panel.elapsedMs = job.elapsedMs;
      if (job.state === "failed") setState(panel, "failed", { error: job.error });
      else setState(panel, job.state, { result: job.result });
      resolve();
    };
    for (const state of ["queued", "reading", "match", "invalid", "unreadable", "failed"]) source.addEventListener(state, finish);
    source.onerror = async () => {
      source.close();
      try {
        const status = url.replace(/\/events$/, "");
        for (;;) {
          const job = await (await fetch(status)).json();
          if (job.done) { finish({ data: JSON.stringify(job) }); return; }
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (error) {
        reject(new Error("lost the connection to the OCR service"));
      }
    };
  });
}

function wirePanel(panel) {
  const { el } = panel;
  for (const drop of el.querySelectorAll(".drop")) {
    const take = (file) => {
      if (!file || !file.type.startsWith("image/")) return;
      panel.files[drop.dataset.side] = file;
      const thumb = drop.querySelector(".thumb");
      if (thumb.src) URL.revokeObjectURL(thumb.src);
      thumb.src = URL.createObjectURL(file);
      drop.classList.add("has-photo");
      if (panel.state !== "reading") setState(panel, "idle", { needPhoto: false, result: null });
    };
    for (const input of drop.querySelectorAll("input[type=file]")) {
      input.addEventListener("change", () => { take(input.files[0]); input.value = ""; });
    }
    // The box itself opens the saved-photo picker; its two buttons say which way.
    drop.addEventListener("click", (event) => {
      if (!event.target.closest(".pick-btn")) drop.querySelector('[data-pick="upload"]').click();
    });
    drop.addEventListener("dragover", (event) => { event.preventDefault(); drop.classList.add("dragging"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
    drop.addEventListener("drop", (event) => { event.preventDefault(); drop.classList.remove("dragging"); take(event.dataTransfer.files[0]); });
  }
  el.querySelector("form").addEventListener("submit", (event) => { event.preventDefault(); read(panel); });
  el.querySelector(".reset").addEventListener("click", () => {
    panel.files = {};
    for (const drop of el.querySelectorAll(".drop")) {
      drop.classList.remove("has-photo");
      const thumb = drop.querySelector(".thumb");
      if (thumb.src) URL.revokeObjectURL(thumb.src);
      thumb.removeAttribute("src");
      for (const input of drop.querySelectorAll("input[type=file]")) input.value = "";
    }
    if (panel.state !== "reading") setState(panel, "idle", { result: null, error: null, elapsedMs: null, needPhoto: false });
  });
}

const mounted = new Set();
/** Mount a page's hero the first time the page is shown (a hidden page has no size to draw at). */
function mountOnce(root, theme) {
  if (mounted.has(root)) return;
  mounted.add(root);
  mountHero(root, theme);
}

function route() {
  const name = location.hash.replace(/^#\/?/, "");
  const id = ROUTES[name] || null;
  document.body.dataset.route = id ? name : "home";
  delete document.documentElement.dataset.deep;
  document.body.dataset.theme = id ? THEME_OF[id] : "egyid";
  const home = document.querySelector('[data-page="home"]');
  home.hidden = Boolean(id);
  for (const panel of panels) panel.page.hidden = panel.type.id !== id;
  for (const link of document.querySelectorAll("[data-nav]")) {
    if (link.dataset.nav === id) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current");
  }
  const shown = id ? panels.find((panel) => panel.type.id === id) : null;
  document.title = shown ? `${shown.type.label.en} · EGY CASH Readers` : "EGY CASH Readers";
  if (shown) mountOnce(shown.page.querySelector(".hero"), shown.type.themeId);
  else mountOnce(home.querySelector(".hero"), "egyid");
  window.scrollTo({ top: 0, behavior: "instant" });
  if (shown && document.activeElement !== document.body) shown.page.focus({ preventScroll: true });
}

function main() {
  // Each page opens at its top; the browser's own scroll restore would land mid-page.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  const host = document.getElementById("reader-pages");
  const template = document.getElementById("page-template");
  for (const type of FALLBACK_TYPES) {
    const page = template.content.firstElementChild.cloneNode(true);
    const el = page.querySelector(".panel");
    for (const node of [page, el]) {
      node.dataset.theme = type.themeId;
      node.dataset.type = type.id;
      node.dataset.state = "idle";
    }
    el.dataset.sides = String(type.sides.length);
    page.dataset.page = ROUTE_OF[type.id];
    page.setAttribute("aria-label", type.label.en);
    page.hidden = true;
    const hero = page.querySelector(".hero");
    hero.classList.add(`hero-${type.themeId}`);
    hero.querySelector(".poster").src = `/ui/poster-${type.themeId}.svg`;
    host.append(page);
    const panel = { page, el, type, state: "idle", files: {}, result: null };
    panels.push(panel);
    wirePanel(panel);
  }

  document.getElementById("lang").addEventListener("click", () => {
    lang = lang === "en" ? "ar" : "en";
    try { localStorage.setItem("readers.lang", lang); } catch { /* fine */ }
    applyLanguage();
  });
  document.getElementById("color").addEventListener("click", () => {
    const root = document.documentElement;
    const dark = root.dataset.color ? root.dataset.color === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.color = dark ? "light" : "dark";
  });
  window.addEventListener("hashchange", route);
  applyLanguage();
  route();
  checkService();
  // Every 15 s while online; every 3 s while it looks down, so it turns green as soon as the service
  // is back; and at once when the tab comes back into view (a tab left open overnight, a laptop
  // that slept: the last answer it holds is stale).
  const recheck = () => {
    if (!document.hidden) checkService();
    setTimeout(recheck, serviceUp === "yes" ? 15000 : 3000);
  };
  setTimeout(recheck, 3000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkService(); });
  window.addEventListener("focus", () => checkService());
  window.addEventListener("online", () => checkService());
}

// For the end-to-end tests: drive a reader without real files.
window.__readers = { panels, setState, render };

main();
