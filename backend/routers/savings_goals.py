from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func
from typing import List
from decimal import Decimal
from models.database import get_db, SavingsGoal, SavingsGoalAllocation, Account
from models.auth import User
from models.schemas import (
    SavingsGoalCreate, SavingsGoalUpdate, SavingsGoalResponse,
    AllocationResponse, SetAllocationsRequest,
)
from utils.auth import get_current_user
from utils.push_sender import send_push_to_user

router = APIRouter(prefix="/savings-goals", tags=["savings"])


def _serialize_goal(goal: SavingsGoal) -> SavingsGoalResponse:
    allocs = [
        AllocationResponse(
            id=a.id,
            account_id=a.account_id,
            account_name=a.account.name if a.account else "Unknown",
            amount=a.amount,
        )
        for a in goal.allocations
    ]
    current = sum(float(a.amount) for a in goal.allocations)
    return SavingsGoalResponse(
        id=goal.id,
        user_id=goal.user_id,
        name=goal.name,
        target_amount=goal.target_amount,
        deadline=goal.deadline,
        created_at=goal.created_at,
        allocations=allocs,
        current_amount=Decimal(str(current)),
    )


def _load_goal(goal_id: int, user_id: int, db: Session) -> SavingsGoal:
    goal = (
        db.query(SavingsGoal)
        .options(joinedload(SavingsGoal.allocations).joinedload(SavingsGoalAllocation.account))
        .filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == user_id)
        .first()
    )
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


@router.post("/", response_model=SavingsGoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(goal: SavingsGoalCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    db_goal = SavingsGoal(
        user_id=current_user.id,
        name=goal.name,
        target_amount=goal.target_amount,
        deadline=goal.deadline,
    )
    db.add(db_goal)
    db.commit()
    db.refresh(db_goal)
    return _serialize_goal(db_goal)


@router.get("/", response_model=List[SavingsGoalResponse])
def get_goals(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    goals = (
        db.query(SavingsGoal)
        .options(joinedload(SavingsGoal.allocations).joinedload(SavingsGoalAllocation.account))
        .filter(SavingsGoal.user_id == current_user.id)
        .order_by(SavingsGoal.created_at)
        .all()
    )
    return [_serialize_goal(g) for g in goals]


@router.put("/{goal_id}", response_model=SavingsGoalResponse)
def update_goal(goal_id: int, update: SavingsGoalUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    goal = _load_goal(goal_id, current_user.id, db)
    for field, value in update.model_dump(exclude_unset=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return _serialize_goal(_load_goal(goal_id, current_user.id, db))


@router.put("/{goal_id}/allocations", response_model=SavingsGoalResponse)
def set_allocations(
    goal_id: int,
    request: SetAllocationsRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _load_goal(goal_id, current_user.id, db)  # verify ownership

    # Validate each allocation against available balance
    for item in request.allocations:
        if float(item.amount) <= 0:
            continue
        account = db.query(Account).filter(
            Account.id == item.account_id,
            Account.user_id == current_user.id,
        ).first()
        if not account:
            raise HTTPException(status_code=404, detail=f"Account {item.account_id} not found")

        # Sum already allocated from this account to OTHER goals
        used_by_others = db.query(func.sum(SavingsGoalAllocation.amount)).filter(
            SavingsGoalAllocation.user_id == current_user.id,
            SavingsGoalAllocation.account_id == item.account_id,
            SavingsGoalAllocation.goal_id != goal_id,
        ).scalar() or 0

        available = float(account.balance) - float(used_by_others)
        if float(item.amount) > available + 0.001:  # small epsilon for float rounding
            raise HTTPException(
                status_code=400,
                detail=f"Only ${available:.2f} available in '{account.name}' (balance minus other goals)",
            )

    # Replace existing allocations for this goal
    db.query(SavingsGoalAllocation).filter(
        SavingsGoalAllocation.goal_id == goal_id,
        SavingsGoalAllocation.user_id == current_user.id,
    ).delete()

    for item in request.allocations:
        if float(item.amount) > 0:
            db.add(SavingsGoalAllocation(
                user_id=current_user.id,
                goal_id=goal_id,
                account_id=item.account_id,
                amount=item.amount,
            ))

    db.commit()
    result = _serialize_goal(_load_goal(goal_id, current_user.id, db))

    # Push notification on milestone (50%, 75%, 100%)
    target = float(result.target_amount)
    current = float(result.current_amount)
    if target > 0:
        pct = current / target
        for milestone, label in [(1.0, "100%"), (0.75, "75%"), (0.5, "50%")]:
            if pct >= milestone:
                icon = "🎉" if milestone == 1.0 else "🎯"
                msg = f"Goal reached!" if milestone == 1.0 else f"You're {label} of the way there!"
                background.add_task(send_push_to_user, db, current_user.id,
                                    f"{icon} {result.name}",
                                    msg, url="/savings", tag=f"goal-{goal_id}")
                break

    return result


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(goal_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    goal = db.query(SavingsGoal).filter(SavingsGoal.id == goal_id, SavingsGoal.user_id == current_user.id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    db.delete(goal)
    db.commit()
