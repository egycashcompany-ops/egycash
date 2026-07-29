"""Egypt's governorates in Arabic — for repairing the address line, and for nothing else.

Every Egyptian address printed on a national ID ends with its governorate, drawn from a closed set
of 27 names (the table below carries 28 entries — the 28th, code 88, is the 'born abroad' marker
the number can hold rather than a place anyone lives). That makes the last token of the address
field the one part of it that can be checked against a list, which is worth having: the address is
the longest, most variable field on the card and the one the recognizer does worst on, so
recovering even its tail saves a reviewer real typing.

**This is deliberately NOT used to validate the national ID, and that restraint is the point.**
Digits 8 and 9 of the number encode the governorate of *birth registration*. The address on the
front is the holder's *residence*. Those are different facts about a person, and in a country where
internal migration is completely ordinary they disagree for a large share of the population — the
cards this feature exists to read include several such. Cross-checking them would therefore fire
constantly on correct reads, and the natural response to a check that cries wolf is to stop
believing it, which would cost more than it ever caught. The number is validated by its own
structure; the address is repaired against this list; the two do not talk to each other.

Codes match `EGYPT_GOVERNORATE_CODES` in `packages/contracts/src/common/value-objects.ts`, which
remains the single source of truth for naming a governorate. This table exists to recognise the
Arabic strings a recognizer produces, which is a different job from labelling a parsed number.
"""

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
#: Mostly the definite article being present or absent, which Egyptian address lines treat as
#: optional, plus the two governorates whose names are routinely written without the hamza.
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
#:
#: Fuzzy matching is not uniformly safe here, and the reason is concrete: البحيرة and الجيزة are a
#: single edit apart once dotting is folded away. A read one edit from البحيرة is therefore also
#: one edit from a completely different governorate three hundred kilometres away, and snapping to
#: either one would be a coin flip presented to the reviewer as a fact. Requiring a unique match
#: does not save this — a read that lands one edit from Beheira and two from Giza is "unique" and
#: still a guess.
#:
#: So approximate matching is offered only where the neighbourhood is empty. Names with no close
#: relative can absorb a dropped letter safely; the crowded pairs fall back to exact-or-rasm, which
#: is where they belong. Computed rather than listed, so it stays correct if the table changes.
_FUZZY_ELIGIBLE: dict[str, str] = {
    folded: name
    for folded, name in _BY_RASM.items()
    if all(
        levenshtein(folded, other, limit=2) > 2 for other in _BY_RASM if other != folded
    )
}


def match_governorate(token: str, *, max_distance: int = 1) -> str | None:
    """The governorate this text names, or None when it names none unambiguously.

    Three passes, each harder to reach than the last: exact after the standard fold, then after
    rasm folding (which forgives the dots a recognizer drops first), then a bounded edit distance
    over the isolated names only. Any pass matching more than one governorate counts as no match —
    inventing a governorate the pixels do not support puts a wrong address into an employee record,
    and a reviewer who sees a plausible place name does not question it. Leaving the rough text in
    place is what makes them read it against the card.
    """
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
    """Repair the governorate at the end of an address line. → (address, snapped).

    Only the tail is touched. Everything before it — building, street, district — is free text with
    no list to check against, and rewriting any of it would be guessing. The governorate is the one
    token on the line that comes from a closed set, so it is the one token that can be corrected
    with evidence rather than by hope.

    The separator is preserved as printed. Egyptian cards use a dash between the district and the
    governorate, and reformatting it would make the value stop matching the card the reviewer is
    holding — which is the one comparison they are about to make.
    """
    if not address.strip():
        return address, False

    # Split on the printed separators, longest-tail-first: the governorate is what follows the
    # final dash, and where there is no dash, the last whitespace-separated word or two.
    for separator in ("-", "،", ","):
        if separator in address:
            head, _, tail = address.rpartition(separator)
            matched = match_governorate(tail)
            if matched is not None:
                spacing = " " if tail.startswith(" ") or tail.endswith(" ") else ""
                return f"{head}{separator}{spacing}{matched}".rstrip(), True
            return address, False

    words = address.split()
    for count in (2, 1):  # 'كفر الشيخ' and 'بني سويف' are two words; the rest are one
        if len(words) >= count:
            matched = match_governorate(" ".join(words[-count:]))
            if matched is not None:
                return " ".join([*words[:-count], matched]), True
    return address, False
