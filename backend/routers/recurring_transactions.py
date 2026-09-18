from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy import or_
from sqlalchemy.orm import Session
from typing import List
from datetime import timedelta
from decimal import Decimal

from models.database import get_db, RecurringDismissal, RecurringTransaction, Transaction, Account, Category
from models.auth import User
from models.schemas import (
    ConfirmSuggestionRequest,
    DismissSuggestionRequest,
    LogVariableRecurringRequest,
    RecurringBillOut,
    RecurringGroupOption,
    RecurringGroupOut,
    RecurringOverviewOut,
    RecurringSuggestionOut,
    RecurringTransactionCreate,
    RecurringTransactionResponse,
    RecurringTransactionUpdate,
    RecurringUpcomingOut,
    TransactionResponse,
)
from services import merchants, recurring_bills, recurring_detection, recurring_groups
from services.ledger import LedgerResourceNotFound, LedgerService
from services.recurring_schedule import UnsupportedPeriodError, next_occurrence
from utils.auth import get_current_user
from utils.dates import user_today
from utils.logging import get_logger, kv
from utils.push_sender import send_push_to_user

router = APIRouter(prefix="/recurring", tags=["recurring"])
logger = get_logger(__name__)


def _owned_account(db: Session, account_id: int, user_id: int) -> Account:
    account = db.query(Account).filter(Account.id == account_id, Account.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _find_owned_category(db: Session, category_id: int, user_id: int) -> Category | None:
    return (
        db.query(Category)
        .filter(Category.id == category_id)
        .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
        .first()
    )


def _owned_category(db: Session, category_id: int | None, user_id: int) -> Category | None:
    if category_id is None:
        return None
    category = _find_owned_category(db, category_id, user_id)
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    return category


def _backfill_groups(db: Session, user_id: int) -> None:
    """Give rows that predate grouping a stored group, once."""
    rows = (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == user_id, RecurringTransaction.group_key.is_(None))
        .all()
    )
    if not rows:
        return
    names = {c.id: c.name for c in db.query(Category).filter(or_(Category.user_id == user_id, Category.user_id.is_(None))).all()}
    for rec in rows:
        if not rec.merchant_key:
            rec.merchant_key = merchants.merchant_key(rec.description) or None
        rec.group_key = recurring_bills.effective_group(rec, names.get(rec.category_id))
    db.commit()


@router.get("/", response_model=List[RecurringTransactionResponse])
def list_recurring(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _backfill_groups(db, current_user.id)
    return (
        db.query(RecurringTransaction)
        .filter(RecurringTransaction.user_id == current_user.id)
        .order_by(RecurringTransaction.next_date)
        .all()
    )


@router.post("/", response_model=RecurringTransactionResponse, status_code=status.HTTP_201_CREATED)
def create_recurring(data: RecurringTransactionCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_account(db, data.account_id, current_user.id)
    category = _owned_category(db, data.category_id, current_user.id)
    values = data.model_dump()
    rec = RecurringTransaction(**values, user_id=current_user.id)
    rec.source = "manual"
    rec.merchant_key = merchants.merchant_key(rec.description) or None
    if rec.group_key is None:
        rec.group_key = recurring_bills.effective_group(rec, category.name if category else None)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.patch("/{rec_id}", response_model=RecurringTransactionResponse)
def update_recurring(rec_id: int, data: RecurringTransactionUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = db.query(RecurringTransaction).filter(RecurringTransaction.id == rec_id, RecurringTransaction.user_id == current_user.id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    changes = data.model_dump(exclude_unset=True)
    if "account_id" in changes:
        _owned_account(db, changes["account_id"], current_user.id)
    if "category_id" in changes:
        _owned_category(db, changes["category_id"], current_user.id)
    if "group_key" in changes and changes["group_key"] is None:
        # Null would mean "derive again"; a move is always to a real group.
        changes.pop("group_key")
    for k, v in changes.items():
        setattr(rec, k, v)
    # A detected bill keeps the identity its charges were found under; a
    # renamed manual bill should match charges under its new name.
    if "description" in changes and rec.source != "detected":
        rec.merchant_key = merchants.merchant_key(rec.description) or None
    db.commit()
    db.refresh(rec)
    return rec


@router.delete("/{rec_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring(rec_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = db.query(RecurringTransaction).filter(RecurringTransaction.id == rec_id, RecurringTransaction.user_id == current_user.id).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(rec)
    db.commit()


# ─── Overview ─────────────────────────────────────────────────────────────────
@router.get("/overview", response_model=RecurringOverviewOut)
def recurring_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Everything the Recurring page needs, in one read.

    Reconciles first so a charge imported since the last visit is already
    shown as paid. Reconciliation is idempotent, so this read stays safe to
    repeat.
    """
    today = user_today(current_user)
    _backfill_groups(db, current_user.id)
    if recurring_bills.reconcile_user(db, current_user, today=today):
        db.commit()

    bills = db.query(RecurringTransaction).filter(RecurringTransaction.user_id == current_user.id).all()
    accounts = {a.id: a for a in db.query(Account).filter(Account.user_id == current_user.id).all()}
    category_names = {
        c.id: c.name
        for c in db.query(Category).filter(or_(Category.user_id == current_user.id, Category.user_id.is_(None))).all()
    }
    month_start, month_end = recurring_bills.month_bounds(today)
    month_tx = (
        db.query(Transaction)
        .filter(
            Transaction.user_id == current_user.id,
            Transaction.transaction_date >= month_start,
            Transaction.transaction_date <= today,
        )
        .all()
    )

    groups: dict[str, list[RecurringBillOut]] = {}
    income: list[RecurringBillOut] = []
    paused: list[RecurringBillOut] = []
    upcoming: list[RecurringUpcomingOut] = []
    totals = {"paid": Decimal("0"), "remaining": Decimal("0"), "typical": Decimal("0"),
              "income_expected": Decimal("0"), "income_typical": Decimal("0")}

    for rec in bills:
        account = accounts.get(rec.account_id)
        group_key = recurring_bills.effective_group(rec, category_names.get(rec.category_id))
        state = recurring_bills.bill_status(rec, account, today)
        figures = recurring_bills.month_figures(rec, month_tx, today)
        is_income = Decimal(str(rec.amount)) > 0
        out = RecurringBillOut.model_validate({
            **RecurringTransactionResponse.model_validate(rec).model_dump(),
            "group_key": "income" if is_income else group_key,
            "group_label": recurring_groups.label_for("income" if is_income else group_key),
            "account_name": account.name if account else None,
            "category_name": category_names.get(rec.category_id),
            "linked": recurring_bills.is_linked(account),
            "status": state.code,
            "status_label": state.label,
            "days_until": state.days_until,
            "monthly_amount": recurring_bills.monthly_equivalent(rec),
            "paid_this_month": figures.paid,
            "remaining_this_month": figures.remaining,
        })

        if not rec.is_active:
            paused.append(out)
            continue
        if is_income:
            income.append(out)
            totals["income_expected"] += figures.expected
            totals["income_typical"] += out.monthly_amount
            continue

        groups.setdefault(group_key, []).append(out)
        totals["paid"] += figures.paid
        totals["remaining"] += figures.remaining
        totals["typical"] += out.monthly_amount
        for due in recurring_bills.occurrences_between(rec, today - timedelta(days=14), today + timedelta(days=30)):
            upcoming.append(RecurringUpcomingOut(
                id=rec.id,
                name=rec.description or "Recurring charge",
                amount=abs(Decimal(str(rec.amount))),
                due_date=due,
                days_until=(due - today).days,
                group_key=group_key,
                is_variable=bool(rec.is_variable),
                linked=out.linked,
                account_name=out.account_name,
            ))

    group_out = [
        RecurringGroupOut(
            key=key,
            label=recurring_groups.label_for(key),
            monthly_total=sum((b.monthly_amount for b in items), Decimal("0")),
            paid_this_month=sum((b.paid_this_month for b in items), Decimal("0")),
            remaining_this_month=sum((b.remaining_this_month for b in items), Decimal("0")),
            bills=sorted(items, key=lambda b: (-b.monthly_amount, b.description or "")),
        )
        for key, items in sorted(groups.items(), key=lambda kv_: recurring_groups.GROUP_ORDER.get(kv_[0], 99))
    ]

    suggestions = [
        RecurringSuggestionOut(
            identity=s.identity,
            name=s.name,
            amount=s.amount,
            period=s.period,
            next_date=s.next_date,
            last_date=s.last_date,
            is_variable=s.is_variable,
            is_income=s.is_income,
            group_key=s.group_key,
            group_label=recurring_groups.label_for(s.group_key),
            account_id=s.account_id,
            account_name=accounts[s.account_id].name if s.account_id in accounts else None,
            category_id=s.category_id,
            occurrences=s.occurrences,
            confidence=s.confidence,
            reasons=s.reasons,
            min_amount=s.min_amount,
            max_amount=s.max_amount,
            monthly_amount=(abs(s.amount) * Decimal(str(round(30.44 / recurring_detection.CYCLE_DAYS[s.period], 6)))).quantize(Decimal("0.01")),
        )
        for s in recurring_detection.detect_cached(db, current_user.id, today)
    ]

    return RecurringOverviewOut(
        month=today.strftime("%Y-%m"),
        today=today,
        expected_this_month=totals["paid"] + totals["remaining"],
        paid_this_month=totals["paid"],
        remaining_this_month=totals["remaining"],
        typical_monthly=totals["typical"],
        income_expected_this_month=totals["income_expected"],
        income_typical_monthly=totals["income_typical"],
        bill_count=sum(len(g.bills) for g in group_out),
        groups=group_out,
        income=sorted(income, key=lambda b: b.next_date),
        paused=paused,
        upcoming=sorted(upcoming, key=lambda u: (u.due_date, u.name)),
        suggestions=suggestions,
        group_options=[RecurringGroupOption(key=k, label=l) for k, l in recurring_groups.GROUPS],
    )


# ─── Suggestions ──────────────────────────────────────────────────────────────
@router.post("/suggestions/confirm", response_model=RecurringTransactionResponse, status_code=status.HTTP_201_CREATED)
def confirm_suggestion(data: ConfirmSuggestionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Track a detected charge. The server re-runs detection rather than
    trusting amounts and dates from the client."""
    today = user_today(current_user)
    match = next((s for s in recurring_detection.detect_cached(db, current_user.id, today) if s.identity == data.identity), None)
    if match is None:
        raise HTTPException(status_code=404, detail="This suggestion is no longer available")

    rec = RecurringTransaction(
        user_id=current_user.id,
        account_id=match.account_id,
        category_id=match.category_id,
        amount=match.amount,
        description=(data.name or match.name).strip()[:120] or match.name,
        period=match.period,
        next_date=match.next_date,
        is_variable=match.is_variable,
        is_active=True,
        group_key="income" if match.is_income else (data.group_key or match.group_key),
        source="detected",
        plaid_merchant_entity_id=match.plaid_merchant_entity_id,
        merchant_key=match.merchant_key,
        last_paid_date=match.last_date,
        last_paid_amount=abs(match.amount) if not match.is_variable else None,
        last_transaction_id=match.last_transaction_id,
    )
    if match.is_variable:
        last = db.query(Transaction).filter(Transaction.id == match.last_transaction_id).first()
        rec.last_paid_amount = abs(last.amount) if last else None
    db.add(rec)
    db.commit()
    db.refresh(rec)
    logger.info("recurring_suggestion_confirmed %s", kv(user_id=current_user.id, period=rec.period, group=rec.group_key))
    return rec


@router.post("/suggestions/dismiss", status_code=status.HTTP_204_NO_CONTENT)
def dismiss_suggestion(data: DismissSuggestionRequest, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    exists = (
        db.query(RecurringDismissal)
        .filter(RecurringDismissal.user_id == current_user.id, RecurringDismissal.identity == data.identity)
        .first()
    )
    if not exists:
        db.add(RecurringDismissal(user_id=current_user.id, identity=data.identity))
        db.commit()


# ─── Posting (manual accounts only) ───────────────────────────────────────────
def _due_manual_rows(db: Session, user_id: int, today):
    """Due fixed bills the app itself must record.

    Bills on bank-linked accounts are excluded: the bank imports those charges
    and `reconcile_user` marks them paid. Posting them here too is what used to
    count every linked subscription twice.
    """
    return (
        db.query(RecurringTransaction)
        .join(Account, Account.id == RecurringTransaction.account_id)
        .filter(
            RecurringTransaction.user_id == user_id,
            RecurringTransaction.is_active == True,  # noqa: E712
            RecurringTransaction.is_variable == False,  # noqa: E712
            RecurringTransaction.next_date <= today,
            Account.plaid_account_id.is_(None),
        )
        .all()
    )


@router.post("/process-due", response_model=List[TransactionResponse])
def process_due(background: BackgroundTasks, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Create transactions for all overdue FIXED recurring entries on manual
    accounts. Variable ones are skipped, and so is anything on a bank-linked
    account, which the bank records itself.

    Due-ness is judged against the user's own calendar day, not the server's —
    see `utils.dates`. A bill due "today" must not fire early for a user west
    of UTC.
    """
    today = user_today(current_user)
    due = _due_manual_rows(db, current_user.id, today)
    created = []
    for rec in due:
        account = db.query(Account).filter(Account.id == rec.account_id, Account.user_id == rec.user_id).first()
        if not account:
            continue
        category = _find_owned_category(db, rec.category_id, rec.user_id) if rec.category_id is not None else None
        if rec.category_id is not None and not category:
            continue
        # Work out the next date *before* writing anything. A row whose period
        # this build cannot schedule (legacy data, direct DB edit) is skipped
        # entirely rather than materialized: creating the transaction and then
        # failing to advance `next_date` is exactly the loop that produced
        # duplicate transactions and balance drift on every subsequent call.
        try:
            advanced = next_occurrence(rec.next_date, rec.period)
        except UnsupportedPeriodError:
            logger.warning(
                "recurring_skipped_unsupported_period %s",
                kv(recurring_id=rec.id, user_id=current_user.id, period=rec.period),
            )
            continue
        try:
            tx = LedgerService(db).stage_transaction(
                current_user.id,
                {
                    "account_id": rec.account_id,
                    "category_id": category.id if category else None,
                    "amount": rec.amount,
                    "description": rec.description,
                    "merchant_key": rec.merchant_key or merchants.merchant_key(rec.description) or None,
                    "transaction_date": rec.next_date,
                },
            )
        except LedgerResourceNotFound:
            # Ownership is checked before anything is staged, so nothing for
            # this row is pending and the rows already staged are kept.
            continue
        rec.last_paid_date = rec.next_date
        rec.last_paid_amount = abs(Decimal(str(rec.amount)))
        rec.last_transaction_id = tx.id
        rec.next_date = advanced
        created.append(tx)
    db.commit()
    for tx in created:
        db.refresh(tx)

    if created:
        n = len(created)
        msg = f"{created[0].description}" if n == 1 else f"{n} recurring transactions"
        background.add_task(send_push_to_user, db, current_user.id,
                            "Recurring transactions processed",
                            f"{msg} {'was' if n == 1 else 'were'} recorded automatically.",
                            url="/recurring", tag="recurring")
    return created


@router.post("/{rec_id}/log", response_model=TransactionResponse)
def log_variable(
    rec_id: int,
    data: LogVariableRecurringRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Log a variable-amount recurring bill with the actual amount for this period."""
    rec = db.query(RecurringTransaction).filter(
        RecurringTransaction.id == rec_id,
        RecurringTransaction.user_id == current_user.id,
    ).first()
    if not rec:
        raise HTTPException(status_code=404, detail="Not found")

    account = _owned_account(db, rec.account_id, current_user.id)
    category = _owned_category(db, rec.category_id, current_user.id)

    # Resolve the next date before writing anything — an unschedulable period
    # must fail before any transaction exists or any balance moves, so the
    # request is a clean 422 rather than a half-applied write. The charge is
    # still dated to the cycle being logged, not to the advanced date.
    due_date = rec.next_date
    try:
        advanced = next_occurrence(due_date, rec.period)
    except UnsupportedPeriodError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    tx_date = data.transaction_date or due_date
    try:
        tx = LedgerService(db).stage_transaction(
            current_user.id,
            {
                "account_id": rec.account_id,
                "category_id": category.id if category else None,
                "amount": data.amount,
                "description": rec.description,
                "merchant_key": rec.merchant_key or merchants.merchant_key(rec.description) or None,
                "transaction_date": tx_date,
            },
        )
        # Save this amount as the new estimate for next time
        rec.amount = data.amount
        rec.last_paid_date = tx_date
        rec.last_paid_amount = abs(Decimal(str(data.amount)))
        rec.last_transaction_id = tx.id
        rec.next_date = advanced
        db.commit()
    except LedgerResourceNotFound as error:
        db.rollback()
        raise HTTPException(status_code=404, detail=error.detail) from error
    except Exception:
        db.rollback()
        raise
    db.refresh(tx)
    return tx
