"""CSV import: parse a bank export, map its columns, find duplicates, post rows.

The shape of the problem: every bank exports a different CSV. Dates come as
ISO, `MM/DD/YYYY` or `DD/MM/YYYY`; amounts as `-12.50`, `(12.50)`, `$1,200.00`
or split across debit/credit columns; the merchant is under "Description",
"Memo", "Payee" or "Name". So the flow is **preview first**: the server parses
the file, suggests a column mapping, normalises every row, flags what it
cannot read and what looks already imported, and only then — on a second,
explicit call with the same mapping — posts the rows through the ledger
service so balances move exactly as they would for a typed entry.

Money is `Decimal` from the first parse; no float is ever formed.

Duplicate detection is a fingerprint of (date, amount, merchant key) against
the user's existing rows in the file's date range, and within the file itself.
A flagged row is skipped by default; the preview says so and the import call
can include them deliberately.

Every row posted carries `import_batch_id`, so a whole import can be undone
in one call and the balances put back.
"""

from __future__ import annotations

import csv
import io
import re
import secrets
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Optional

from sqlalchemy.orm import Session

from models.database import Category, Transaction
from services import merchants

MAX_TEXT_BYTES = 400 * 1024  # under the idempotency middleware's 512 KB cap
MAX_ROWS = 5000
PREVIEW_SAMPLE = 50
CENTS = Decimal("0.01")

FIELDS = ("date", "amount", "description", "category", "debit", "credit")
DATE_FORMATS = ("auto", "ymd", "mdy", "dmy")

# Header words that usually mean each field, most specific first.
_HINTS = {
    "date": ("transaction date", "posted date", "post date", "date"),
    "amount": ("amount", "transaction amount", "value", "sum"),
    "debit": ("debit", "withdrawal", "money out", "paid out", "outflow"),
    "credit": ("credit", "deposit", "money in", "paid in", "inflow"),
    "description": ("description", "memo", "payee", "name", "merchant", "narrative", "details", "transaction"),
    "category": ("category",),
}


class ImportError_(ValueError):
    """The file itself cannot be used (too large, unreadable, no rows)."""


@dataclass
class ParsedRow:
    row_number: int
    raw: dict
    date: Optional[date] = None
    amount: Optional[Decimal] = None
    description: str = ""
    category_name: str = ""
    category_id: Optional[int] = None
    errors: list[str] = field(default_factory=list)
    duplicate: bool = False

    @property
    def ok(self) -> bool:
        return not self.errors


@dataclass
class Preview:
    headers: list[str]
    mapping: dict[str, Optional[str]]
    total: int
    valid: int
    invalid: int
    duplicates: int
    rows: list[ParsedRow]
    sample: list[ParsedRow]


# ─── Parsing ──────────────────────────────────────────────────────────────────
def parse_csv(text: str) -> tuple[list[str], list[dict]]:
    if len(text.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ImportError_(f"The file is too large; the limit is {MAX_TEXT_BYTES // 1024} KB")
    text = text.lstrip("﻿")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect)
    try:
        headers = next(reader)
    except StopIteration:
        raise ImportError_("The file is empty")
    headers = [h.strip() for h in headers]
    if not any(headers):
        raise ImportError_("The first line must name the columns")
    rows: list[dict] = []
    for values in reader:
        if not any(v.strip() for v in values):
            continue
        rows.append({headers[i]: (values[i] if i < len(values) else "").strip() for i in range(len(headers))})
        if len(rows) > MAX_ROWS:
            raise ImportError_(f"Too many rows; the limit is {MAX_ROWS} per file")
    if not rows:
        raise ImportError_("No rows found under the header line")
    return headers, rows


def suggest_mapping(headers: list[str]) -> dict[str, Optional[str]]:
    """Guess which column is which. Debit/credit only when there is no amount."""
    lowered = {h: h.lower().strip() for h in headers}
    taken: set[str] = set()
    mapping: dict[str, Optional[str]] = {f: None for f in FIELDS}
    for target in ("date", "amount", "debit", "credit", "category", "description"):
        for hint in _HINTS[target]:
            match = next((h for h, low in lowered.items() if h not in taken and (low == hint or hint in low)), None)
            if match:
                mapping[target] = match
                taken.add(match)
                break
    if mapping["amount"]:
        mapping["debit"] = mapping["credit"] = None
    return mapping


_AMOUNT_JUNK = re.compile(r"[^\d.,()\-+]")


def parse_amount(raw: str) -> Optional[Decimal]:
    text = (raw or "").strip()
    if not text:
        return None
    negative = text.startswith("(") and text.endswith(")")
    cleaned = _AMOUNT_JUNK.sub("", text).strip("()")
    if "," in cleaned and "." in cleaned:
        # Both present: the last one is the decimal mark, the other groups thousands.
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(",") == 1 and len(cleaned.split(",")[1]) in (1, 2):
        cleaned = cleaned.replace(",", ".")  # decimal comma
    else:
        cleaned = cleaned.replace(",", "")
    try:
        value = Decimal(cleaned)
    except InvalidOperation:
        return None
    if negative:
        value = -abs(value)
    return value.quantize(CENTS)


_DATE_PATTERNS = {
    "ymd": ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"),
    "mdy": ("%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y"),
    "dmy": ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y"),
}
_DATE_TEXT = ("%b %d, %Y", "%d %b %Y", "%B %d, %Y", "%d %B %Y")


def parse_date(raw: str, date_format: str = "auto") -> Optional[date]:
    text = (raw or "").strip()
    if not text:
        return None
    text = text.split("T")[0].split(" ")[0] if re.match(r"^\d{4}-\d{2}-\d{2}", text) else text
    orders = [date_format] if date_format in _DATE_PATTERNS else ["ymd", "mdy", "dmy"]
    for order in orders:
        for pattern in _DATE_PATTERNS[order]:
            try:
                return datetime.strptime(text, pattern).date()
            except ValueError:
                continue
    for pattern in _DATE_TEXT:
        try:
            return datetime.strptime(text, pattern).date()
        except ValueError:
            continue
    return None


# ─── Normalising ──────────────────────────────────────────────────────────────
def _category_lookup(db: Session, user_id: int) -> dict[str, int]:
    rows = db.query(Category).filter(Category.user_id == user_id).all()
    return {c.name.strip().lower(): c.id for c in rows}


def normalize(
    db: Session,
    user_id: int,
    rows: list[dict],
    mapping: dict[str, Optional[str]],
    *,
    date_format: str = "auto",
    flip_sign: bool = False,
) -> list[ParsedRow]:
    """Turn raw rows into typed ones, recording every problem per row."""
    if not mapping.get("date"):
        raise ImportError_("Choose which column holds the date")
    if not mapping.get("amount") and not (mapping.get("debit") or mapping.get("credit")):
        raise ImportError_("Choose an amount column, or debit and credit columns")
    categories = _category_lookup(db, user_id)
    parsed: list[ParsedRow] = []
    for index, raw in enumerate(rows, start=2):  # row 1 is the header
        row = ParsedRow(row_number=index, raw=raw)
        row.date = parse_date(raw.get(mapping["date"], ""), date_format)
        if row.date is None:
            row.errors.append("unreadable date")
        if mapping.get("amount"):
            row.amount = parse_amount(raw.get(mapping["amount"], ""))
            if row.amount is not None and flip_sign:
                row.amount = -row.amount
        else:
            debit = parse_amount(raw.get(mapping["debit"] or "", "")) if mapping.get("debit") else None
            credit = parse_amount(raw.get(mapping["credit"] or "", "")) if mapping.get("credit") else None
            if debit is not None and debit != 0:
                row.amount = -abs(debit)
            elif credit is not None and credit != 0:
                row.amount = abs(credit)
            elif debit is not None or credit is not None:
                row.amount = Decimal("0.00")
        if row.amount is None:
            row.errors.append("unreadable amount")
        elif row.amount == 0:
            row.errors.append("zero amount")
        description_col = mapping.get("description")
        row.description = (raw.get(description_col, "") if description_col else "").strip()[:500]
        category_col = mapping.get("category")
        if category_col:
            row.category_name = raw.get(category_col, "").strip()
            if row.category_name:
                row.category_id = categories.get(row.category_name.lower())
        parsed.append(row)
    return parsed


# ─── Duplicates ───────────────────────────────────────────────────────────────
def _fingerprint(day: date, amount: Decimal, description: str) -> tuple:
    return (day, amount.quantize(CENTS), merchants.merchant_key(description) or (description or "").strip().lower())


def flag_duplicates(db: Session, user_id: int, rows: list[ParsedRow], account_id: int) -> None:
    """Mark rows that already exist in this account or repeat within the file."""
    dated = [r for r in rows if r.ok]
    if not dated:
        return
    first = min(r.date for r in dated)
    last = max(r.date for r in dated)
    existing = (
        db.query(Transaction.transaction_date, Transaction.amount, Transaction.description, Transaction.merchant_key)
        .filter(
            Transaction.user_id == user_id,
            Transaction.account_id == account_id,
            Transaction.transaction_date >= first,
            Transaction.transaction_date <= last,
        )
        .all()
    )
    seen: set[tuple] = set()
    for day, amount, description, key in existing:
        seen.add((day, Decimal(str(amount)).quantize(CENTS), key or merchants.merchant_key(description) or (description or "").strip().lower()))
    for row in dated:
        fp = _fingerprint(row.date, row.amount, row.description)
        if fp in seen:
            row.duplicate = True
        else:
            seen.add(fp)


# ─── Orchestration ────────────────────────────────────────────────────────────
def preview(
    db: Session,
    user_id: int,
    text: str,
    *,
    account_id: int,
    mapping: Optional[dict[str, Optional[str]]] = None,
    date_format: str = "auto",
    flip_sign: bool = False,
) -> Preview:
    headers, raw_rows = parse_csv(text)
    chosen = dict(suggest_mapping(headers))
    if mapping:
        for key in FIELDS:
            if key in mapping:
                chosen[key] = mapping[key] or None
        for key, column in chosen.items():
            if column and column not in headers:
                raise ImportError_(f"Column “{column}” is not in the file")
    rows = normalize(db, user_id, raw_rows, chosen, date_format=date_format, flip_sign=flip_sign)
    flag_duplicates(db, user_id, rows, account_id)
    valid = [r for r in rows if r.ok]
    return Preview(
        headers=headers,
        mapping=chosen,
        total=len(rows),
        valid=len(valid),
        invalid=len(rows) - len(valid),
        duplicates=sum(1 for r in valid if r.duplicate),
        rows=rows,
        sample=rows[:PREVIEW_SAMPLE],
    )


def new_batch_id() -> str:
    return secrets.token_hex(8)
