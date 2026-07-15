from decimal import Decimal
from typing import Any, Mapping

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.database import Account, Category, Transaction


class LedgerResourceNotFound(Exception):
    def __init__(self, resource: str):
        self.resource = resource
        super().__init__(f"{resource} not found")

    @property
    def detail(self) -> str:
        return str(self)


class LedgerService:
    """Coordinates transaction writes and their account balance effects."""

    def __init__(self, session: Session):
        self._session = session

    def create_transaction(self, user_id: int, values: Mapping[str, Any]) -> Transaction:
        try:
            account = self._get_accounts(user_id, [values["account_id"]])[values["account_id"]]
            self._validate_category(user_id, values.get("category_id"))

            transaction = Transaction(**values, user_id=user_id)
            self._session.add(transaction)
            self._adjust_balance(account, self._as_decimal(values["amount"]))
            self._session.commit()
            self._session.refresh(transaction)
            return transaction
        except Exception:
            self._session.rollback()
            raise

    def update_transaction(
        self,
        user_id: int,
        transaction_id: int,
        changes: Mapping[str, Any],
    ) -> Transaction:
        try:
            transaction = self._get_transaction(user_id, transaction_id)
            changes = dict(changes)
            self._validate_category_change(user_id, changes)

            old_account_id = transaction.account_id
            new_account_id = changes.get("account_id", old_account_id)
            old_amount = self._as_decimal(transaction.amount)
            new_amount = self._as_decimal(changes.get("amount", old_amount))
            accounts = self._get_accounts(user_id, [old_account_id, new_account_id])

            if old_account_id == new_account_id:
                self._adjust_balance(accounts[old_account_id], new_amount - old_amount)
            else:
                self._adjust_balance(accounts[old_account_id], -old_amount)
                self._adjust_balance(accounts[new_account_id], new_amount)

            for field, value in changes.items():
                setattr(transaction, field, value)

            self._session.commit()
            self._session.refresh(transaction)
            return transaction
        except Exception:
            self._session.rollback()
            raise

    def delete_transaction(self, user_id: int, transaction_id: int) -> None:
        try:
            transaction = self._get_transaction(user_id, transaction_id)
            account = self._get_accounts(user_id, [transaction.account_id])[transaction.account_id]
            self._adjust_balance(account, -self._as_decimal(transaction.amount))
            self._session.delete(transaction)
            self._session.commit()
        except Exception:
            self._session.rollback()
            raise

    def _get_transaction(self, user_id: int, transaction_id: int) -> Transaction:
        transaction = (
            self._session.query(Transaction)
            .filter(Transaction.id == transaction_id, Transaction.user_id == user_id)
            .with_for_update()
            .first()
        )
        if not transaction:
            raise LedgerResourceNotFound("Transaction")
        return transaction

    def _get_accounts(self, user_id: int, account_ids: list[int | None]) -> dict[int, Account]:
        if any(account_id is None for account_id in account_ids):
            raise LedgerResourceNotFound("Account")
        unique_ids = sorted(set(account_ids))
        accounts = (
            self._session.query(Account)
            .filter(Account.id.in_(unique_ids), Account.user_id == user_id)
            .order_by(Account.id)
            .with_for_update()
            .all()
        )
        accounts_by_id = {account.id: account for account in accounts}
        if len(accounts_by_id) != len(unique_ids):
            raise LedgerResourceNotFound("Account")
        return accounts_by_id

    def _validate_category_change(self, user_id: int, changes: Mapping[str, Any]) -> None:
        if "category_id" in changes:
            self._validate_category(user_id, changes["category_id"])

    def _validate_category(self, user_id: int, category_id: int | None) -> None:
        if category_id is None:
            return
        category = (
            self._session.query(Category)
            .filter(Category.id == category_id)
            .filter(or_(Category.user_id == user_id, Category.user_id.is_(None)))
            .with_for_update()
            .first()
        )
        if not category:
            raise LedgerResourceNotFound("Category")

    @staticmethod
    def _adjust_balance(account: Account, delta: Decimal) -> None:
        account.balance = Account.balance + delta

    @staticmethod
    def _as_decimal(value: Any) -> Decimal:
        return Decimal(str(value))
