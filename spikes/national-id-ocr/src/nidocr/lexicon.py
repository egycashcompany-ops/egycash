"""Correcting misread letters in names and addresses against words the card is likely to carry."""

from __future__ import annotations

import re
from functools import lru_cache

from .arabic import normalize_arabic, rasm_fold
from .governorates import GOVERNORATES_AR

# ── Word lists ─────────────────────────────────────────────────────────────────

_GIVEN_NAMES = """
محمد احمد محمود مصطفى علي حسن حسين ابراهيم اسماعيل اسحاق يوسف يعقوب موسى عيسى هارون داود سليمان
عمر عثمان خالد طارق عمرو اشرف هشام وائل وليد سامح سامي سمير شريف شادي شوقي صبري صلاح صالح صابر
جمال كمال جلال حمدي بدوي رمضان رجب شعبان حماد حمادة حامد حميد مجدي فتحي فوزي رشدي
عادل عاطف عاصم عصام عزت عزيز عماد عمار عوض عيد فارس فاروق فؤاد فهمي فيصل قاسم كريم ماهر مازن
مدحت مراد مرسي مسعد معتز منير منصور مهدي نبيل نادر ناصر نصر نشأت نعيم هاني هاشم هيثم ياسر
ياسين يحيى زكريا زكي زياد زين زيد سعد سعيد سلامة سلام سيد السيد شحاتة شاكر صفوت ضياء طلعت طه
ايمن ايهاب بهاء بكر بلال تامر ثروت جابر جودة حازم حاتم حسام حسني رافت رامي
رضا رضوان رفعت رؤوف سالم سراج سليم شهاب علاء غريب فرج فكري قدري كامل لطفي
متولي محسن مختار مرزوق مسعود معوض نجيب نور هلال وجدي وحيد يسري يونس الدين عز عبده عرفة عطية
فاطمة عائشة خديجة زينب مريم اسماء امنة امينة هدى منى نادية سعاد سميرة سلمى سارة نورا نورهان
هبة ايمان ياسمين رانيا دينا شيماء ولاء الاء اية رحاب نهى نهال نجلاء هالة هند منال امال سهير
عزة رشا غادة مها ميرفت ابتسام انتصار فايزة كريمة سامية نعمة صفية حنان حسناء شهد جنى ملك ندى
""".split()

#: The names of God that Egyptian names are compounded with, printed joined: عبدالحميد.
_DIVINE = """
الله الرحمن الرحيم الملك القدوس السلام المؤمن المهيمن العزيز الجبار المتكبر الخالق البارئ
المصور الغفار القهار الوهاب الرزاق الفتاح العليم الباسط الحفيظ الحليم العظيم الغفور الشكور
العلي الكبير الحكيم الودود المجيد الباعث الحق الوكيل القوي المتين الحميد المعطي المنعم الواحد
الصمد القادر المقتدر الاول الاخر الظاهر الباطن البر التواب العفو الرؤوف الغني الهادي البديع
الباقي الرشيد الصبور الستار اللطيف الخبير الجليل الكريم الرقيب المجيب الواسع الشهيد الحي القيوم
النور الحافظ العاطي الناصر المعز الجواد العال السميع البصير العدل الحسيب
""".split()

_ADDRESS_WORDS = """
شارع ش ميدان حارة عطفة درب طريق كورنيش برج عمارة عمارات بلوك قطعة مربع منطقة مساكن مدينة
حي الحي قسم مركز شياخة قرية عزبة كفر نجع منشية منشاة الشهيد الجديدة القديمة اول ثان ثالث رابع
شرق غرب شمال جنوب البحري القبلي الرئيسي العمومي التحرير الجمهورية النصر الثورة
الحرية الجلاء الهرم فيصل الدقي العجوزة المهندسين امبابة بولاق الزمالك المعادي حلوان شبرا
المطرية الزيتون حدائق القبة مصر الجديدة نصر العاشر السابع الثامن التاسع الحادي عشر
السادس الخامس الرابع الثالث الثاني العبور الشروق المقطم السيدة الخليفة الجمالية
الموسكي الازبكية عابدين الوايلي باب الشعرية الساحل روض الفرج المرج البساتين دار
الرمل سيدي جابر المنتزه العطارين المنشية الجمرك اللبان محرم بك كرموز مينا البصل العامرية
الدخيلة العجمي العرب سموحة ستانلي لوران سبورتنج كليوباترا ميامي المندرة العصافرة
المحروسة الشيخ الحاج الطالبية العمرانية الوراق اكتوبر زايد
""".split()


#: Districts (مراكز وأقسام) by governorate, the part of an Egyptian address with the most varied
#: words and the most to gain from a list. A floor, not a gazetteer: villages are not here.
_DISTRICTS = """
بني سويف الواسطى ناصر اهناسيا ببا سمسطا الفشن
المنيا العدوة مغاغة بني مزار مطاي سمالوط ملوي دير مواس ابو قرقاص
اسيوط ديروط القوصية منفلوط ابنوب الفتح ساحل سليم البداري صدفا الغنايم ابو تيج
سوهاج اخميم ساقلتة المراغة طهطا جهينة طما المنشاة جرجا البلينا دار السلام العسيرات
قنا ابو تشت فرشوط نجع حمادي الوقف دشنا قفط قوص نقادة
الاقصر اسنا ارمنت الطود اسوان دراو كوم امبو النوبة ادفو
الفيوم طامية سنورس اطسا يوسف الصديق ابشواي
الجيزة العياط الصف اطفيح البدرشين اوسيم كرداسة منشاة القناطر الحوامدية الواحات
بنها قليوب شبرا الخيمة القناطر الخيرية الخانكة كفر شكر طوخ شبين
الزقازيق بلبيس منيا القمح ابو حماد ابو كبير فاقوس الحسينية ههيا ديرب نجم صقر اولاد
الابراهيمية مشتول السوق القرين صان الحجر الصالحية
المنصورة طلخا ميت غمر دكرنس اجا منية السنبلاوين بلقاس المطرية شربين تمي الامديد
الجمالية نبروه بني عبيد سلسيل المنزلة
طنطا المحلة الكبرى الزيات زفتى السنطة قطور بسيون سمنود
الكوم منوف اشمون الباجور قويسنا بركة السبع تلا الشهداء السادات
دمنهور الدوار رشيد ادكو المطامير حمص الدلنجات المحمودية الرحمانية ايتاي البارود
حوش عيسى شبراخيت كوم حمادة وادي النطرون
دسوق فوه مطوبس بيلا الحامول سيدي سالم الرياض قلين البرلس
دمياط فارسكور الزرقا سعد البطيخ
الاسماعيلية فايد القنطرة التل الكبير صوير
عين شمس النزهة الشرابية الاميرية الزاوية الحمراء التبين مايو الوايلي حلوان المعصرة
""".split()


@lru_cache(maxsize=1)
def _names() -> frozenset[str]:
    words = set(_GIVEN_NAMES) | {"عبد"}
    words.update("عبد" + divine for divine in _DIVINE)
    return frozenset(words)


@lru_cache(maxsize=1)
def _address() -> frozenset[str]:
    # Streets are named after people as often as anything else, so the address knows names too.
    words = set(_ADDRESS_WORDS) | set(_DISTRICTS) | set(_names())
    for name in GOVERNORATES_AR.values():
        words.update(name.split())
    return frozenset(words)


@lru_cache(maxsize=2)
def _index(kind: str) -> tuple[frozenset[str], dict[str, frozenset[str]]]:
    words = _names() if kind == "name" else _address()
    known = frozenset(normalize_arabic(word) for word in words)
    grouped: dict[str, set[str]] = {}
    for word in words:
        grouped.setdefault(rasm_fold(word), set()).add(normalize_arabic(word))
    # Variants that normalize the same (ة/ه, ى/ي) are one word, not two candidates.
    by_skeleton = {key: frozenset(value) for key, value in grouped.items()}
    original = {normalize_arabic(word): word for word in words}
    return known, {k: frozenset(original[w] for w in v) for k, v in by_skeleton.items()}


#: Letters whose dotless shapes blur into each other on a soft photo (on the skeleton; dot-only
#: pairs like ح/خ/ج and ف/ق already share one).
_LOOKALIKE = {("ح", "ع"), ("ع", "ح"), ("د", "ر"), ("ر", "د")}


def _one_lookalike_apart(left: str, right: str) -> bool:
    if len(left) != len(right):
        return False
    differences = [(a, b) for a, b in zip(left, right) if a != b]
    return len(differences) == 1 and differences[0] in _LOOKALIKE


def _abd_compound(token: str) -> str | None:
    """عبد + a name of God, with a blurred عبد: 'جيدالحميد' → 'عبدالحميد'."""
    head, tail = token[:3], token[3:]
    divine = {normalize_arabic(word) for word in _DIVINE}
    if normalize_arabic(tail) not in divine or head == "عبد":
        return None
    skeleton, abd = rasm_fold(head), rasm_fold("عبد")
    if skeleton == abd or _one_lookalike_apart(skeleton, abd):
        return "عبد" + tail
    return None


#: The commonest name as soft phone photos of real cards misread it: its middle meem lost, or read
#: as a sad. Spelled out, not searched for: 'محد' is also one letter from 'مجدي', and a rule loose
#: enough to find this changed real names. Neither spelling is anybody's name.
_MUHAMMAD_MISREADS = frozenset({"محد", "محصد"})


def _blur_misread_name(token: str) -> str | None:
    """A name misread in one of two ways a soft photo makes, put right only when exactly one listed
    name results. → the name, or None.

    Both were seen on a live phone photo of a real card: 'اشرف' read 'الشرف' (the alef's foot and
    the gap after it taken for a lam) and 'فارس' read 'قارص' (the seen's teeth filled in, read as a
    sad). Anything looser was measured against real names the list does not hold and changed one in
    seven ('خليل' to 'جلال', 'عدلي' to 'علي'); these two changed none, a real 'صابر' or 'الجندي'
    included, because a real name is either listed or does not turn into one this way.
    """
    known, by_skeleton = _index("name")
    word = normalize_arabic(token)
    if len(word) < 4:
        return None
    found: set[str] = set()
    if word.startswith("ال") and normalize_arabic("ا" + word[2:]) in known:
        found.add("ا" + word[2:])
    for index, letter in enumerate(word):
        if letter == "ص":
            seen = word[:index] + "س" + word[index + 1 :]
            found |= {normalize_arabic(name) for name in by_skeleton.get(rasm_fold(seen), ())}
    if len(found) != 1:
        return None
    fixed = next(iter(found))
    return next((name for name in _names() if normalize_arabic(name) == fixed), fixed)


def _correct_token(token: str, kind: str) -> str:
    known, by_skeleton = _index(kind)
    if not token or normalize_arabic(token) in known:
        return token
    compound = _abd_compound(token)
    if compound is not None:
        return compound
    if kind == "name":
        if normalize_arabic(token) in _MUHAMMAD_MISREADS:
            return "محمد"
        blurred = _blur_misread_name(token)
        if blurred is not None:
            return blurred
    # The definite article and a leading و are prefixes, not part of the word.
    for prefix in ("", "ال", "و", "وال"):
        if prefix and not token.startswith(prefix):
            continue
        stem = token[len(prefix):]
        # Four letters at least: a three-letter skeleton matches too many words (حتى read in an
        # address became the name جنى) for one candidate to mean anything.
        if len(stem) < 4:
            continue
        if normalize_arabic(stem) in known:
            return token
        skeleton = rasm_fold(stem)
        same = by_skeleton.get(skeleton, frozenset())
        if len(same) == 1:
            return prefix + next(iter(same))
        # Look-alike letters for address words only.
        if kind == "address" and len(stem) >= 4 and not same:
            near = {
                word
                for key, words in by_skeleton.items()
                if _one_lookalike_apart(skeleton, key)
                for word in words
            }
            if len(near) == 1:
                return prefix + next(iter(near))
        # One tooth letter too many or too few (ب ت ث ن ي share one shape, ٮ, on the skeleton): a
        # soft photo adds a tooth to a word or merges two away, سمسطا read سمسيطا.
        if kind == "address" and len(stem) >= 5 and not same:
            near = {
                word
                for key, words in by_skeleton.items()
                if _one_tooth_apart(skeleton, key)
                for word in words
            }
            if len(near) == 1:
                return prefix + next(iter(near))
    return token


def _one_tooth_apart(left: str, right: str) -> bool:
    """Does deleting a single interior tooth (ٮ) from the longer skeleton give the shorter one?"""
    if abs(len(left) - len(right)) != 1:
        return False
    longer, shorter = (left, right) if len(left) > len(right) else (right, left)
    return any(
        longer[i] == "ٮ" and longer[:i] + longer[i + 1 :] == shorter
        for i in range(1, len(longer) - 1)
    )


#: Arabic vowel marks (fatha … sukun, the superscript alef) and the tatweel.
_HARAKAT = re.compile(r"[ً-ْٰـ]")


def _join_split_names(tokens: list[str]) -> list[str]:
    """Rejoin a name the recognizer split at a gap the card prints inside it.

    Some names are printed with their letters spaced out — 'هدى' as 'هـ دى' — and the recognizer
    puts a space there: 'هد ى'. Two neighbours are joined only when one of them is not a listed
    name on its own and the two together are: two real names side by side stay apart.
    """
    known = _index("name")[0]
    out: list[str] = []
    for token in tokens:
        if out:
            joined = out[-1] + token
            apart_known = normalize_arabic(out[-1]) in known and normalize_arabic(token) in known
            if not apart_known and normalize_arabic(joined) in known:
                out[-1] = joined
                continue
        out.append(token)
    return out


def correct(text: str, kind: str) -> tuple[str, bool]:
    """Correct misread letters in a name ('name') or an address ('address'). → (text, changed)."""
    tokens = text.split()
    if kind == "name":
        # A card prints names without vowel marks; one in a read ('علْى') is the recognizer's.
        tokens = [token for token in (_HARAKAT.sub("", token) for token in tokens) if token]
    joined = _join_split_names(tokens) if kind == "name" else tokens
    fixed = [_correct_token(token, kind) for token in joined]
    return " ".join(fixed), fixed != tokens


def near_miss(text: str, kind: str) -> bool:
    """Is a word of `text` NOT a listed word but one edit (a letter added, lost or changed) from one?

    That is the shape of a misread: a real card's given name lost a letter and still scored 0.91.
    A word far from every listed one (most family names) says nothing, and a listed word is fine.
    A three-letter word may be two edits off: there a lost letter changes most of the word (a real
    card's given name came back that way at 0.915).
    """
    from .arabic import levenshtein  # noqa: PLC0415 - local, like the rest of this module's helpers

    known, _ = _index(kind)
    for token in text.split():
        word = normalize_arabic(token)
        if len(word) < 3 or word in known:
            continue
        edits = 2 if len(word) == 3 else 1
        if any(abs(len(word) - len(other)) <= edits and levenshtein(word, other, limit=edits) <= edits for other in known):
            return True
    return False
