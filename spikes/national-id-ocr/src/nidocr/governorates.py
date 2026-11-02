"""Egypt's governorates in Arabic, for repairing the address line, and for nothing else."""

from __future__ import annotations

from .arabic import levenshtein, normalize_arabic, rasm_fold

#: code → the name as printed. Kept keyed by code so the table lines up with the contracts package
#: and a reader can check the two side by side.
GOVERNORATES_AR: dict[str, str] = {
    "01": "القاهرة",
    "02": "الإسكندرية",
    "03": "بورسعيد",
    "04": "السويس",
    "11": "دمياط",
    "12": "الدقهلية",
    "13": "الشرقية",
    "14": "القليوبية",
    "15": "كفر الشيخ",
    "16": "الغربية",
    "17": "المنوفية",
    "18": "البحيرة",
    "19": "الإسماعيلية",
    "21": "الجيزة",
    "22": "بني سويف",
    "23": "الفيوم",
    "24": "المنيا",
    "25": "أسيوط",
    "26": "سوهاج",
    "27": "قنا",
    "28": "أسوان",
    "29": "الأقصر",
    "31": "البحر الأحمر",
    "32": "الوادي الجديد",
    "33": "مطروح",
    "34": "شمال سيناء",
    "35": "جنوب سيناء",
    "88": "خارج الجمهورية",
}

#: Spellings that appear on real cards and in real data entry but are not the canonical form.
_ALIASES: dict[str, str] = {
    "القاهره": "القاهرة",
    "الاسكندرية": "الإسكندرية",
    "اسكندرية": "الإسكندرية",
    "بور سعيد": "بورسعيد",
    "الدقهليه": "الدقهلية",
    "كفرالشيخ": "كفر الشيخ",
    "بنى سويف": "بني سويف",
    "اسيوط": "أسيوط",
    "اسوان": "أسوان",
    "الاقصر": "الأقصر",
    "الوادى الجديد": "الوادي الجديد",
    "شمال سينا": "شمال سيناء",
    "جنوب سينا": "جنوب سيناء",
}

_BY_NORMALIZED = {normalize_arabic(name): name for name in GOVERNORATES_AR.values()}
_BY_NORMALIZED.update({normalize_arabic(alias): name for alias, name in _ALIASES.items()})
_BY_RASM = {rasm_fold(name): name for name in GOVERNORATES_AR.values()}

#: Governorates far enough from every other one to be matched approximately.
_FUZZY_ELIGIBLE: dict[str, str] = {
    folded: name
    for folded, name in _BY_RASM.items()
    if all(
        levenshtein(folded, other, limit=2) > 2 for other in _BY_RASM if other != folded
    )
}


def match_governorate(token: str, *, max_distance: int = 1) -> str | None:
    """The governorate this text names, or None when it names none unambiguously."""
    key = normalize_arabic(token)
    if not key:
        return None
    if key in _BY_NORMALIZED:
        return _BY_NORMALIZED[key]

    folded = rasm_fold(token)
    if folded in _BY_RASM:
        return _BY_RASM[folded]

    near = {
        name
        for candidate, name in _FUZZY_ELIGIBLE.items()
        if levenshtein(folded, candidate, limit=max_distance) <= max_distance
    }
    return near.pop() if len(near) == 1 else None


def snap_address_tail(address: str) -> tuple[str, bool]:
    """Repair the governorate at the end of an address line. → (address, snapped)."""
    if not address.strip():
        return address, False

    def as_printed(tail: str, matched: str) -> str:
        # Right apart from a word-final ى/ي or ة/ه, spellings the card itself uses (بنى سويف):
        # keep what is printed.
        printed, official = tail.split(), matched.split()
        if len(printed) != len(official):
            return matched
        for got, want in zip(printed, official):
            if got == want:
                continue
            if len(got) != len(want) or got[:-1] != want[:-1]:
                return matched
            if {got[-1], want[-1]} not in ({"ى", "ي"}, {"ة", "ه"}):
                return matched
        return tail.strip()

    # Split on the printed separators, longest-tail-first: the governorate is what follows the
    # final dash, and where there is no dash, the last whitespace-separated word or two.
    for separator in ("-", "،", ","):
        if separator in address:
            head, _, tail = address.rpartition(separator)
            matched = match_governorate(tail)
            if matched is not None:
                spacing = " " if tail.startswith(" ") or tail.endswith(" ") else ""
                return f"{head}{separator}{spacing}{as_printed(tail, matched)}".rstrip(), True
            return address, False

    words = address.split()
    for count in (2, 1):  # 'كفر الشيخ' and 'بني سويف' are two words; the rest are one
        if len(words) >= count:
            matched = match_governorate(" ".join(words[-count:]))
            if matched is not None:
                return " ".join([*words[:-count], as_printed(" ".join(words[-count:]), matched)]), True
    return address, False
