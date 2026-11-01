"""The document types the service reads. Adding one is an entry here plus its rules module (ADR-014).

Each entry names its reader and its verdict as "module:function" strings, so the service never
imports a document's code directly and a document's rules live in their own file.
"""

from __future__ import annotations

import importlib
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class DocumentType:
    id: str
    label: dict[str, str]
    theme_id: str
    #: Photos it takes: ("front", "back") for a two-sided card, ("front",) for a single page.
    sides: tuple[str, ...]
    #: What must be seen on the photo before it counts as this document (for the UI and the docs).
    required_evidence: tuple[str, ...]
    #: field name → kind ("text", "digits", "date"), the fields this reader may return.
    field_schema: dict[str, str]
    reader_ref: str
    verdict_ref: str
    #: The invalid-state message, shown when a scan is `not_match`. Drafts: need a native review.
    invalid_message: dict[str, str]
    aliases: tuple[str, ...] = field(default_factory=tuple)

    def reader(self) -> Callable[..., Any]:
        return _load(self.reader_ref)

    def verdict(self) -> Callable[..., Any]:
        return _load(self.verdict_ref)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": dict(self.label),
            "themeId": self.theme_id,
            "sides": list(self.sides),
            "requiredEvidence": list(self.required_evidence),
            "fields": dict(self.field_schema),
            "invalidMessage": dict(self.invalid_message),
        }


def _load(ref: str) -> Callable[..., Any]:
    module, _, name = ref.partition(":")
    return getattr(importlib.import_module(module), name)


def _read_national_id(front, back, recognizer, **_):
    from .extract import extract  # noqa: PLC0415 - lazy: heavy imports

    return extract(front, back, recognizer)


def _read_egycash_id(front, back, recognizer, **_):
    # By module path: the package re-exports a function named `extract`, which shadows the module.
    extract_module = importlib.import_module("nidocr.extract")

    photo = front or back
    if photo is None:
        raise ValueError("the EGY CASH ID's photo is imageBase64 (or frontImageBase64)")
    return extract_module.extract_badge(photo, recognizer)


def _read_army_exemption(front, back, recognizer, holder=None, **_):
    from .army_exemption import extract_exemption  # noqa: PLC0415

    return extract_exemption(front, back, recognizer, holder=holder)


_TYPES: tuple[DocumentType, ...] = (
    DocumentType(
        id="national_id",
        label={"en": "National ID Card", "ar": "بطاقة الرقم القومي"},
        theme_id="nid",
        sides=("front", "back"),
        required_evidence=("card title words (front)", "back marker words or barcode (back)", "14-digit number"),
        field_schema={
            "fullNameAr": "text", "nationalId": "digits", "address": "text", "occupation": "text",
            "religion": "text", "maritalStatus": "text", "gender": "text", "expiryDate": "date",
        },
        reader_ref="nidocr.registry:_read_national_id",
        verdict_ref="nidocr.verdict:national_id_verdict",
        invalid_message={
            "en": "This does not look like a National ID Card.",
            "ar": "هذه لا تبدو بطاقة رقم قومي.",
        },
    ),
    DocumentType(
        id="egycash_id",
        label={"en": "EGY CASH ID", "ar": "بطاقة EGY CASH ID"},
        theme_id="egyid",
        sides=("front",),
        required_evidence=("company name or logo", "employee code <branch><number>"),
        field_schema={
            "companyName": "text", "fullNameAr": "text", "jobTitle": "text",
            "employeeCode": "digits", "nationalId": "digits",
        },
        reader_ref="nidocr.registry:_read_egycash_id",
        verdict_ref="nidocr.verdict:egycash_id_verdict",
        invalid_message={"en": "This is not an EGY CASH ID.", "ar": "هذه ليست بطاقة EGY CASH ID."},
        aliases=("egycash_badge",),
    ),
    DocumentType(
        id="army_exemption",
        label={"en": "Army Exemption Certificate", "ar": "شهادة الإعفاء من الخدمة العسكرية"},
        theme_id="army",
        sides=("front",),
        # The labels and layout behind this come from profiles/documents/army-exemption.json.
        required_evidence=("certificate title and labels (from samples)", "14-digit number", "plausible dates",
                           "birth date agrees with the national ID number"),
        field_schema={},
        reader_ref="nidocr.registry:_read_army_exemption",
        verdict_ref="nidocr.army_exemption:exemption_verdict",
        invalid_message={
            "en": "This does not look like an Army Exemption Certificate.",
            "ar": "هذه لا تبدو شهادة إعفاء من الخدمة العسكرية.",
        },
    ),
)

_BY_NAME = {entry.id: entry for entry in _TYPES}
_ALIASES = {alias: entry.id for entry in _TYPES for alias in entry.aliases}


def all_types() -> tuple[DocumentType, ...]:
    return _TYPES


def get(name: str) -> DocumentType:
    return _BY_NAME[name]


def resolve(name: str) -> tuple[DocumentType, str | None]:
    """→ (entry, deprecation note or None). KeyError naming the valid types for an unknown one."""
    if name in _BY_NAME:
        return _BY_NAME[name], None
    if name in _ALIASES:
        current = _ALIASES[name]
        return _BY_NAME[current], f"documentType {name} is renamed {current}; the old name will be removed"
    raise KeyError(f"documentType must be one of: {', '.join(_BY_NAME)}")


def catalogue() -> list[dict[str, Any]]:
    """The types as JSON, for GET /types and the UI."""
    entries = []
    for entry in _TYPES:
        data = entry.as_dict()
        if entry.id == "army_exemption":
            from .army_exemption import load_profile  # noqa: PLC0415

            profile = load_profile()
            data["configured"] = profile.configured
            data["fields"] = {name: profile.spec(name)["kind"] for name in profile.fields}
            if profile.exemption_types:
                data["fields"]["exemptionType"] = "text"
        entries.append(data)
    return entries
