"""The paycheck plan API. The rules live in `services.paycheck_plan`."""

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from models.auth import User
from models.database import get_db
from services import paycheck_plan as service
from utils.auth import get_current_user
from utils.dates import user_today

router = APIRouter(prefix="/paycheck-plan", tags=["paycheck plan"])


# ─── Schemas ──────────────────────────────────────────────────────────────────
class PaycheckSourceIn(BaseModel):
    merchant_key: str = Field(min_length=1, max_length=120)
    name: str = Field(min_length=1, max_length=120)


class PaycheckLineIn(BaseModel):
    goal_id: int
    amount: Decimal = Field(gt=0, le=1_000_000)
    account_id: Optional[int] = None


class PaycheckPlanIn(BaseModel):
    sources: List[PaycheckSourceIn] = Field(default_factory=list, max_length=20)
    lines: List[PaycheckLineIn] = Field(default_factory=list, max_length=50)
    notify: bool = True


class TickIn(BaseModel):
    payday: date
    line_id: int
    set_aside: bool = True


class PaycheckSourceOut(BaseModel):
    merchant_key: str
    name: str


class PaycheckLineOut(BaseModel):
    id: int
    goal_id: int
    goal_name: str
    amount: Decimal
    account_id: Optional[int] = None
    account_name: Optional[str] = None


class SourceSuggestionOut(BaseModel):
    merchant_key: str
    name: str
    count: int
    typical_amount: Decimal
    gap_days: int


class DepositOut(BaseModel):
    name: str
    amount: Decimal
    account_id: int


class BillDueOut(BaseModel):
    name: str
    amount: Decimal
    date: date
    paid: bool


class PaydayLineOut(PaycheckLineOut):
    done: bool
    set_aside: bool


class PaydayOut(BaseModel):
    date: date
    amount: Decimal
    deposits: List[DepositOut]
    next_payday: date
    bills: List[BillDueOut]
    bills_total: Decimal
    lines: List[PaydayLineOut]
    planned_total: Decimal
    free: Decimal


class PaycheckPlanOut(BaseModel):
    configured: bool
    notify: bool
    sources: List[PaycheckSourceOut]
    lines: List[PaycheckLineOut]
    suggested_sources: List[SourceSuggestionOut]
    gap_days: int
    paydays_per_month: Decimal
    latest: Optional[PaydayOut] = None


# ─── Serialisation ────────────────────────────────────────────────────────────
def _line_out(line) -> dict:
    return {
        "id": line.id,
        "goal_id": line.goal_id,
        "goal_name": line.goal.name if line.goal else "Goal",
        "amount": line.amount,
        "account_id": line.account_id,
        "account_name": line.account.name if line.account else None,
    }


def _response(db: Session, user: User) -> PaycheckPlanOut:
    today = user_today(user)
    plan = service.get_plan(db, user.id)
    suggestions = [
        SourceSuggestionOut(
            merchant_key=s.merchant_key, name=s.name, count=s.count,
            typical_amount=s.typical_amount, gap_days=s.gap_days,
        )
        for s in service.suggest_sources(db, user.id, today)
    ]
    if plan is None:
        return PaycheckPlanOut(
            configured=False, notify=True, sources=[], lines=[], suggested_sources=suggestions,
            gap_days=service.DEFAULT_GAP_DAYS,
            paydays_per_month=service.paydays_per_month(service.DEFAULT_GAP_DAYS).quantize(Decimal("0.01")),
        )
    current, gap = service.latest_payday_plan(db, plan, today)
    latest = None
    if current is not None:
        latest = PaydayOut(
            date=current.payday.on,
            amount=current.payday.amount,
            deposits=[DepositOut(name=d.name, amount=d.amount, account_id=d.account_id) for d in current.payday.deposits],
            next_payday=current.next_payday,
            bills=[BillDueOut(name=b.name, amount=b.amount, date=b.on, paid=b.paid) for b in current.bills],
            bills_total=current.bills_total,
            lines=[PaydayLineOut(**_line_out(s.line), done=s.done, set_aside=s.set_aside) for s in current.lines],
            planned_total=current.planned_total,
            free=current.free,
        )
    return PaycheckPlanOut(
        configured=bool(plan.sources),
        notify=plan.notify,
        sources=[PaycheckSourceOut(merchant_key=s.merchant_key, name=s.name) for s in plan.sources],
        lines=[PaycheckLineOut(**_line_out(line)) for line in plan.lines],
        suggested_sources=suggestions,
        gap_days=gap,
        paydays_per_month=service.paydays_per_month(gap).quantize(Decimal("0.01")),
        latest=latest,
    )


# ─── Routes ───────────────────────────────────────────────────────────────────
@router.get("", response_model=PaycheckPlanOut)
def get_paycheck_plan(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """The plan, the latest payday worked through it, and payers that look like pay."""
    return _response(db, current_user)


@router.put("", response_model=PaycheckPlanOut)
def put_paycheck_plan(body: PaycheckPlanIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    try:
        service.save_plan(
            db,
            current_user.id,
            sources=[(s.merchant_key, s.name) for s in body.sources],
            lines=[service.LineInput(goal_id=l.goal_id, amount=l.amount, account_id=l.account_id) for l in body.lines],
            notify=body.notify,
        )
    except service.PlanError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _response(db, current_user)


@router.post("/ticks", response_model=PaycheckPlanOut)
def tick_line(body: TickIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Mark a line done for a payday; with `set_aside`, also set its money aside for the goal."""
    try:
        service.tick(db, current_user.id, body.line_id, body.payday, body.set_aside)
    except LookupError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except service.NotEnoughFree as error:
        db.rollback()
        raise HTTPException(status_code=409, detail={"message": str(error), "available": str(error.available)}) from error
    except service.PlanError as error:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(error)) from error
    return _response(db, current_user)


@router.delete("/lines/{line_id}/ticks/{payday}", response_model=PaycheckPlanOut)
def untick_line(line_id: int, payday: date, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Undo a tick; money it set aside is taken back off the goal."""
    service.untick(db, current_user.id, line_id, payday)
    return _response(db, current_user)
