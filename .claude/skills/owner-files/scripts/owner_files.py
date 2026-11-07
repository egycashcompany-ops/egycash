"""Checks to run on an owner's file BEFORE converting or reading it (see ../SKILL.md).

Every check prints structure only — sheet names, header labels, counts, flags — never a data cell,
so it is safe to run on a workbook that holds secrets. Run it with the MarkItDown venv's Python in
isolated mode, e.g.:

    <scratchpad>/markitdown/bin/python -I .claude/skills/owner-files/scripts/owner_files.py workbook /abs/in/book.xlsx

Subcommands:
    workbook <xlsx>    sheets (state, size, merges), the header row, secret-looking columns,
                       long numbers, formulas with no saved result
    csv <csv>          the encoding to pass to MarkItDown (-c), or none
    mojibake <md>      whether converted text looks mis-decoded
    zipsize <file>     entries and total uncompressed size of a zip-based file; nested archives
    docx <docx>        tracked changes and comments (MarkItDown shows changes as accepted)
"""

from __future__ import annotations

import json
import re
import sys
import zipfile

# Header patterns that mark a column as secret. Matching is on the folded header (lower case,
# whitespace collapsed). Sources: docs/12-planning/atm-efficiency-register.md (J..Q keys, AN, AU,
# AO combination) and apps/api/src/modules/fleet/fuel-cards/reconcile/read-fuel-sheet.ts («pass»,
# «قيمه الشحن»).
SECRET_HEADER_PATTERNS = [
    r"\bkeys?\b",
    r"\bp\.?\s?w\b",
    r"combination",
    r"pass(word)?\b",
    r"\bpin\b",
    r"notes received",
    r"notes delivered",
    r"كلم[ةه] (ال)?سر",
    r"(ال)?رقم (ال)?سر[يى]",
    r"باسورد",
    r"مفاتيح|مفتاح",
    r"(ال)?تركيب[ةه]|كومبينيشن",
    r"قيم[ةه] الشحن",
]
# The ATM efficiency register's classified columns, by letter, when its headers are recognised.
ATM_REGISTER_SECRET_COLUMNS = ["J", "K", "L", "M", "N", "O", "P", "Q", "AN", "AO", "AU"]
ARCHIVE_SUFFIXES = (".zip", ".7z", ".rar", ".gz", ".tar", ".tgz", ".bz2", ".xz")


def fold(value: object) -> str:
    return re.sub(r"\s+", " ", str(value)).strip().lower()


def is_secret_header(header: str) -> bool:
    folded = fold(header)
    return any(re.search(pattern, folded) for pattern in SECRET_HEADER_PATTERNS)


def header_row(ws, scan: int = 10) -> tuple[int, list[tuple[str, str]]]:
    """The row among the first `scan` with the most text cells, as (letter, header) pairs."""
    from openpyxl.utils import get_column_letter

    best_row, best = 0, []
    for index, row in enumerate(ws.iter_rows(min_row=1, max_row=scan), start=1):
        labels = [
            (get_column_letter(cell.column), str(cell.value))
            for cell in row
            if isinstance(cell.value, str) and cell.value.strip()
        ]
        if len(labels) > len(best):
            best_row, best = index, labels
    return best_row, best


def check_workbook(path: str) -> dict:
    from openpyxl import load_workbook

    formulas = load_workbook(path, data_only=False)
    values = load_workbook(path, data_only=True)
    sheets = []
    secret_bearing = False
    for ws in formulas.worksheets:
        cached = values[ws.title]
        row_index, headers = header_row(ws)
        secret_columns = [
            {"column": letter, "header": header[:60]}
            for letter, header in headers
            if is_secret_header(header)
        ]
        folded_headers = {fold(h) for _, h in headers}
        looks_like_atm_register = "atm id" in folded_headers and ws.max_column >= 40
        formula_cells = formula_without_value = long_numbers = vlookups = 0
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if isinstance(value, str) and value.startswith("="):
                    formula_cells += 1
                    if "VLOOKUP" in value.upper():
                        vlookups += 1
                    if cached[cell.coordinate].value is None:
                        formula_without_value += 1
                elif isinstance(value, (int, float)) and not isinstance(value, bool):
                    if abs(value) >= 1e10:
                        long_numbers += 1
        flagged = bool(secret_columns) or looks_like_atm_register or vlookups > 0
        secret_bearing = secret_bearing or bool(secret_columns) or looks_like_atm_register
        sheets.append(
            {
                "name": ws.title,
                "state": ws.sheet_state,
                "rows": ws.max_row,
                "columns": ws.max_column,
                "merged": [str(r) for r in list(ws.merged_cells.ranges)[:5]],
                "mergedCount": len(ws.merged_cells.ranges),
                "headerRow": row_index,
                "headers": [f"{letter}: {header[:40]}" for letter, header in headers],
                "secretColumns": secret_columns,
                "looksLikeAtmRegister": looks_like_atm_register,
                "vlookupCells": vlookups,
                "formulaCells": formula_cells,
                "formulasWithNoSavedResult": formula_without_value,
                "numbersOf11DigitsOrMore": long_numbers,
                "flagged": flagged,
            }
        )
    advice = []
    if secret_bearing:
        advice.append(
            "SECRET-BEARING: do not run MarkItDown on this workbook. Read it with a script that "
            "skips the secretColumns"
            + (
                f" and, for the ATM register, columns {', '.join(ATM_REGISTER_SECRET_COLUMNS)}"
                " and any sheet with VLOOKUPs (Sheet1)"
                if any(s["looksLikeAtmRegister"] for s in sheets)
                else ""
            )
            + "; never print a secret value."
        )
    if any(s["state"] != "visible" for s in sheets):
        advice.append("Hidden sheets present: MarkItDown includes them unmarked; tell the owner.")
    if any(s["formulasWithNoSavedResult"] for s in sheets):
        advice.append(
            "Formulas with no saved result: MarkItDown shows them as NaN; read formula text with "
            "openpyxl (data_only=False) and say the results were not saved."
        )
    if any(s["numbersOf11DigitsOrMore"] for s in sheets):
        advice.append(
            "Long numbers (IDs, accounts): MarkItDown may print them as 2.98e+13; take every such "
            "value from openpyxl, never from the Markdown."
        )
    return {"file": path, "secretBearing": secret_bearing, "sheets": sheets, "advice": advice}


def check_csv(path: str) -> dict:
    data = open(path, "rb").read()
    try:
        data.decode("utf-8")
        return {"file": path, "encoding": "utf-8", "markitdownCharsetFlag": None}
    except UnicodeDecodeError:
        try:
            data.decode("cp1256")
            return {"file": path, "encoding": "cp1256", "markitdownCharsetFlag": "-c cp1256"}
        except UnicodeDecodeError:
            return {"file": path, "encoding": "unknown", "markitdownCharsetFlag": None}


def check_mojibake(path: str) -> dict:
    text = open(path, encoding="utf-8", errors="replace").read()
    ta_za_runs = len(re.findall(r"(?:[طظ][؀-ۿ]){4,}", text))
    cjk = len(re.findall(r"[぀-ヿ㐀-鿿가-힯]", text))
    presentation_forms = len(re.findall(r"[ﭐ-﷿ﹰ-﻿]", text))
    replacement = text.count("�") + len(re.findall(r"\?{3,}", text))
    suspicious = ta_za_runs > 0 or cjk > 0 or presentation_forms > 0 or replacement > 0
    return {
        "file": path,
        "suspicious": suspicious,
        "taZaRuns": ta_za_runs,
        "cjkChars": cjk,
        "arabicPresentationForms": presentation_forms,
        "replacementMarks": replacement,
    }


def check_zip(path: str) -> dict:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        nested = [e.filename for e in entries if e.filename.lower().endswith(ARCHIVE_SUFFIXES)]
        embedded = [e.filename for e in entries if "/embeddings/" in e.filename]
        return {
            "file": path,
            "entries": len(entries),
            "uncompressedBytes": sum(e.file_size for e in entries),
            "nestedArchives": nested[:10],
            "officeEmbeddings": len(embedded),
        }


def check_docx(path: str) -> dict:
    with zipfile.ZipFile(path) as archive:
        body = archive.read("word/document.xml").decode("utf-8", errors="replace")
        names = set(archive.namelist())
        comments = 0
        if "word/comments.xml" in names:
            comments = archive.read("word/comments.xml").decode("utf-8", "replace").count("<w:comment ")
    return {
        "file": path,
        "insertions": body.count("<w:ins "),
        "deletions": body.count("<w:del "),
        "comments": comments,
        "note": "MarkItDown shows insertions as accepted, drops deletions and comments.",
    }


COMMANDS = {
    "workbook": check_workbook,
    "csv": check_csv,
    "mojibake": check_mojibake,
    "zipsize": check_zip,
    "docx": check_docx,
}

if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[1] not in COMMANDS:
        sys.exit(__doc__)
    print(json.dumps(COMMANDS[sys.argv[1]](sys.argv[2]), ensure_ascii=False, indent=1))
