/**
 * Moved to `features/accounts/calculations/cards.ts`.
 *
 * Account arithmetic belongs to the Accounts feature. This re-export keeps the
 * Overview imports working while they are migrated; it holds no logic of its
 * own, so there is nothing here that can drift from the real implementation.
 */

export {
  HIGH_UTILIZATION,
  UTILIZATION_LABELS,
  amountOwed,
  cardUtilization,
  describeBalance,
  totalCardDebt,
  totalCreditLimit,
  utilizationBand,
  utilizationLabel,
  type UtilizationBand,
} from '../../accounts/calculations/cards';
