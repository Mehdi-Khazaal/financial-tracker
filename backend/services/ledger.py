from decimal import Decimal
from typing import Any, Mapping

from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.database import Account, Category, Transaction
from services.transaction_enrichment import (
    SOURCE_USER,
    enrich_transaction_input,
    resolve_transaction_merchant,
)


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
        """Post one transaction and commit. The single-write entry point."""
        try:
            transaction = self.stage_transaction(user_id, values)
            self._session.commit()
            self._session.refresh(transaction)
            return transaction
        except Exception:
            self._session.rollback()
            raise

    def stage_transaction(self, user_id: int, values: Mapping[str, Any]) -> Transaction:
        """Validate, enrich, add the row and move the balance — without committing.

        This is the one way a transaction enters the ledger. Savings-goal
        spends, the assistant's confirmed writes, recurring posting and
        variable-bill logging all call it, so every posted row gets the same
        ownership checks, the same merchant identity, and — the part that
        matters for money — the same **atomic** balance update: the delta is
        applied as a SQL expression (`balance = balance + delta`), never as
        Python arithmetic on a value read earlier. Two writers that race, such
        as a Plaid sync and a user entry, both land.

        Callers that post several rows (recurring posting) stage each and
        commit once; a failure rolls back the lot. The caller owns the
        transaction boundary and is responsible for `rollback()` on error.

        An explicit `merchant_key` in `values` is kept. A tracked bill carries
        the identity its charges were matched under, which may differ from the
        key its display name would derive to.
        """
        values = dict(values)
        account = self._get_accounts(user_id, [values.get("account_id")])[values["account_id"]]
        self._validate_category(user_id, values.get("category_id"))

        explicit_key = values.get("merchant_key")

        # One shared enrichment step for both ingestion paths — see
        # `services.transaction_enrichment`. Resolves merchant identity,
        # registers the alias, and suggests a category only when the
        # caller did not supply one.
        suggested_category = values.get("category_id")
        values = enrich_transaction_input(self._session, user_id, values)
        if values.get("category_id") != suggested_category:
            # A suggested category still has to be one this user may use.
            # If it is not, drop the suggestion rather than failing the
            # write — the transaction is fine, the guess was not.
            try:
                self._validate_category(user_id, values["category_id"])
            except LedgerResourceNotFound:
                values["category_id"] = suggested_category
                values.pop("category_source", None)
        if explicit_key:
            values["merchant_key"] = explicit_key

        transaction = Transaction(**values, user_id=user_id)
        self._session.add(transaction)
        self._adjust_balance(account, self._as_decimal(values["amount"]))
        # Assign the primary key now so a caller can link to the row (a bill's
        # `last_transaction_id`) before the surrounding commit.
        self._session.flush()
        return transaction

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

            # A category the user set by hand is marked as theirs, so a later
            # Plaid sync can tell a deliberate choice from an inferred one and
            # leave it alone.
            if "category_id" in changes:
                changes["category_source"] = (
                    SOURCE_USER if changes["category_id"] is not None else None
                )
            # Re-derive merchant identity when the description changes, so the
            # stored key never drifts from the text it was derived from.
            if "description" in changes:
                identity = resolve_transaction_merchant(
                    changes["description"],
                    plaid_merchant_entity_id=transaction.plaid_merchant_entity_id,
                )
                changes["merchant_key"] = identity.key or None

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

            # A split is only valid for the amount it was made for, and filing
            # the whole transaction under a different category un-splits it.
            recategorised = "category_id" in changes and changes["category_id"] != transaction.category_id
            if new_amount != old_amount or recategorised:
                from services import splits as split_service
                split_service.clear(transaction)

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

    def stage_delete(self, user_id: int, transaction: Transaction) -> None:
        """Remove a row and reverse its balance effect — without committing.

        The batch form of `delete_transaction`: an import undo removes every
        row of the batch under one commit, so a failure part-way leaves the
        ledger exactly as it was.
        """
        if transaction.user_id != user_id:
            raise LedgerResourceNotFound("Transaction")
        account = self._get_accounts(user_id, [transaction.account_id])[transaction.account_id]
        self._adjust_balance(account, -self._as_decimal(transaction.amount))
        self._session.delete(transaction)
        # Each delta is a SQL expression on the row; flushing now means the
        # next row in the batch compounds on the stored balance instead of
        # replacing an unflushed expression on the same account object.
        self._session.flush()

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
