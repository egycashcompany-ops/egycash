"""The document-type registry: a new document is an entry plus its rules, not a new code path."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from nidocr import registry  # noqa: E402


def test_the_three_readers_are_registered_with_both_labels_and_a_theme():
    for name, theme in (("national_id", "nid"), ("egycash_id", "egyid"), ("army_exemption", "army")):
        entry = registry.get(name)
        assert entry.id == name
        assert entry.theme_id == theme
        assert entry.label["en"] and entry.label["ar"]


def test_the_national_id_is_called_national_id_card():
    assert registry.get("national_id").label["en"] == "National ID Card"


def test_the_badge_is_now_egycash_id():
    assert registry.get("egycash_id").label["en"] == "EGY CASH ID"


def test_the_old_badge_name_resolves_with_a_deprecation_note():
    entry, note = registry.resolve("egycash_badge")
    assert entry.id == "egycash_id"
    assert note and "egycash_id" in note


def test_a_current_name_resolves_without_a_note():
    entry, note = registry.resolve("national_id")
    assert entry.id == "national_id"
    assert note is None


def test_an_unknown_type_is_refused_naming_the_valid_ones():
    with pytest.raises(KeyError) as caught:
        registry.resolve("passport")
    message = str(caught.value)
    for name in ("national_id", "egycash_id", "army_exemption"):
        assert name in message


def test_every_entry_points_at_a_reader_and_a_verdict_that_exist():
    for entry in registry.all_types():
        assert callable(entry.reader())
        assert callable(entry.verdict())


def test_every_entry_declares_its_fields_and_evidence():
    for entry in registry.all_types():
        assert isinstance(entry.field_schema, dict)
        assert isinstance(entry.required_evidence, tuple)
    assert "nationalId" in registry.get("national_id").field_schema
    assert "employeeCode" in registry.get("egycash_id").field_schema


def test_the_catalogue_is_json_ready_for_the_ui():
    catalogue = registry.catalogue()
    ids = [item["id"] for item in catalogue]
    assert ids == ["national_id", "egycash_id", "army_exemption"]
    assert all({"label", "themeId", "sides", "fields"} <= set(item) for item in catalogue)
