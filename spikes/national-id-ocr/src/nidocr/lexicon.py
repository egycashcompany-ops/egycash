"""Correcting misread letters in names and addresses against words the card is likely to carry.

WHY. On a soft photo the recognizer keeps a word's shape and loses its dots: ح comes back خ or ج,
ب comes back ي, ث comes back ن. Worse, a few letters that differ in shape still blur into each
other — ح and ع — so المحروسة is read المعروسة. The result looks right at a glance and is not a
word at all, and a reviewer skims past it.

HOW, and how far. Each token that is not already a known word is compared with the word lists
below on its dotless skeleton (`arabic.rasm_fold`):

  1. Same skeleton, different dots — a known word that differs only in dotting. Taken only when
     EXACTLY ONE known word has that skeleton; two candidates leave the token alone.
  2. One look-alike letter apart on the skeleton (ح↔ع, د↔ر) — ADDRESS words only, four letters or
     more, only when no known word shares its skeleton, and only when exactly one is that close.
     Never names: it turned a real, uncommon name into a common one.

Nothing else is ever changed: a name that is not in the lists is somebody's real name and stays as
read. A field this corrects is capped at 'medium' by the caller — a correction is a deduction, and
a reviewer must still look.

The lists are deliberately built in and small: common Egyptian given names, the compounds of عبد,
and the vocabulary of Egyptian addresses. They are a floor, not a gazetteer; a district or street
list can be added later without changing the rules above.
"""

from __future__ import annotations

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


@lru_cache(maxsize=1)
def _names() -> frozenset[str]:
    words = set(_GIVEN_NAMES) | {"عبد"}
    words.update("عبد" + divine for divine in _DIVINE)
    return frozenset(words)


@lru_cache(maxsize=1)
def _address() -> frozenset[str]:
    # Streets are named after people as often as anything else, so the address knows names too.
    words = set(_ADDRESS_WORDS) | set(_names())
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
    """عبد + a name of God, with a blurred عبد: 'جيدالحميد' → 'عبدالحميد'.

    The one place a look-alike letter is corrected in a name, because it is not a name being
    guessed: the tail is one of a closed list, and عبد is the only word that ever precedes it.
    """
    head, tail = token[:3], token[3:]
    divine = {normalize_arabic(word) for word in _DIVINE}
    if normalize_arabic(tail) not in divine or head == "عبد":
        return None
    skeleton, abd = rasm_fold(head), rasm_fold("عبد")
    if skeleton == abd or _one_lookalike_apart(skeleton, abd):
        return "عبد" + tail
    return None


def _correct_token(token: str, kind: str) -> str:
    known, by_skeleton = _index(kind)
    if not token or normalize_arabic(token) in known:
        return token
    compound = _abd_compound(token)
    if compound is not None:
        return compound
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
        # Look-alike letters for ADDRESS words only. On names it turned a real, uncommon name
        # (بدوى) into a common one (ثروت) — د and ر — which is invention, not correction; dots are
        # the only thing a name is corrected on.
        if kind == "address" and len(stem) >= 4 and not same:
            near = {
                word
                for key, words in by_skeleton.items()
                if _one_lookalike_apart(skeleton, key)
                for word in words
            }
            if len(near) == 1:
                return prefix + next(iter(near))
    return token


def correct(text: str, kind: str) -> tuple[str, bool]:
    """Correct misread letters in a name ('name') or an address ('address'). → (text, changed)."""
    tokens = text.split()
    fixed = [_correct_token(token, kind) for token in tokens]
    return " ".join(fixed), fixed != tokens
