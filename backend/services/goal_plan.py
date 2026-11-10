"""When each goal is really reached, funding them in priority order.

Mirrors `frontend/src/features/portfolio/calculations/goalPlan.ts`.

Every goal used to be projected as if it alone received everything saved each
month. Four goals each "finishing" on the full $783 a month cannot all be
true: the live account's goals needed $6,405.69 a month together. Here money
is spent once:

* A goal with a paycheck-plan line gets that line every month (amount per
  payday times paydays per month).
* The rest of what is kept each month goes to the highest-priority unfinished
  goal, and what it does not need flows to the next.
* A finished goal's line flows down the list too.

The result is one finish month per goal, which is what can honestly be
compared with its date.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional, Sequence

ZERO = Decimal("0")
HORIZON_MONTHS = 120


@dataclass(frozen=True)
class GoalIn:
    goal_id: int
    remaining: Decimal
    deadline: Optional[date]


@dataclass(frozen=True)
class PlannedGoal:
    goal_id: int
    # Months from now until it is fully funded; 0 when it already is; None when
    # not within the horizon.
    months_to_finish: Optional[int]
    # Months from now until its deadline; None without a future deadline.
    months_to_deadline: Optional[int]
    # What it needs each month to finish by its date; None without a future date.
    needed_monthly: Optional[Decimal]
    # complete | on-time | late | date-passed | no-deadline | never | unknown
    status: str

    @property
    def late_by_months(self) -> Optional[int]:
        if self.status != "late" or self.months_to_finish is None or self.months_to_deadline is None:
            return None
        return self.months_to_finish - self.months_to_deadline


def months_until(deadline: date, today: date) -> int:
    """Whole months to a deadline, as the screens count them (a later day this month still counts)."""
    months = (deadline.year - today.year) * 12 + (deadline.month - today.month)
    return max(0, months + (0 if deadline.day >= today.day else -1))


def plan(
    goals: Sequence[GoalIn],
    *,
    monthly_saving: Optional[Decimal],
    committed: dict[int, Decimal],
    today: date,
) -> list[PlannedGoal]:
    """Plan `goals`, given in priority order (first funded first)."""
    remaining = {g.goal_id: max(ZERO, g.remaining) for g in goals}
    lines = {g.goal_id: max(ZERO, committed.get(g.goal_id, ZERO)) for g in goals}
    # The lines are the plan; typical saving beyond them flows down the list.
    # A line keeps paying after its goal is funded, and that money flows too.
    base = max(ZERO, monthly_saving or ZERO)
    lines_total = sum(lines.values(), ZERO)
    flow = max(ZERO, base - lines_total)
    has_capacity = flow > 0 or lines_total > 0

    finish: dict[int, Optional[int]] = {g.goal_id: (0 if remaining[g.goal_id] == 0 else None) for g in goals}
    if has_capacity:
        for month in range(1, HORIZON_MONTHS + 1):
            pool = flow
            for g in goals:
                line = lines[g.goal_id]
                if line <= 0:
                    continue
                paid = min(line, remaining[g.goal_id])
                remaining[g.goal_id] -= paid
                pool += line - paid
            for g in goals:
                if pool <= 0:
                    break
                if remaining[g.goal_id] > 0:
                    paid = min(pool, remaining[g.goal_id])
                    remaining[g.goal_id] -= paid
                    pool -= paid
            for g in goals:
                if finish[g.goal_id] is None and remaining[g.goal_id] <= 0:
                    finish[g.goal_id] = month
            if all(v is not None for v in finish.values()):
                break

    out = []
    for g in goals:
        to_deadline = months_until(g.deadline, today) if g.deadline and g.deadline >= today else None
        needed = (
            (g.remaining / max(1, to_deadline)).quantize(Decimal("0.01"))
            if to_deadline is not None and g.remaining > 0 else None
        )
        months = finish[g.goal_id]
        if g.remaining <= 0:
            status = "complete"
        elif g.deadline and g.deadline < today:
            status = "date-passed"
        elif not has_capacity:
            status = "unknown"
        elif months is None:
            status = "never"
        elif g.deadline is None:
            status = "no-deadline"
        elif months <= max(1, to_deadline or 0):
            status = "on-time"
        else:
            status = "late"
        out.append(PlannedGoal(g.goal_id, months, to_deadline, needed, status))
    return out
