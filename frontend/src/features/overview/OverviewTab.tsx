import React from 'react';
import { Link } from 'react-router-dom';
import type {
  Account,
  Asset,
  BudgetProgressSummary,
  Category,
  Collection,
  MonthSnapshot,
  RecurringOverview,
  RecurringTransaction,
  SavingsGoal,
  Transaction,
} from '../../types';
import { useOverviewModel } from './useOverviewModel';
import MorningBrief from './components/MorningBrief';
import OverviewHero from './components/OverviewHero';
import MetricRow from './components/MetricRow';
import MonthActivityCard from './components/MonthActivityCard';
import ImportReviewCard from './components/ImportReviewCard';
import AccountsGrid from './components/AccountsGrid';
import GoalsList from './components/GoalsList';
import BudgetsCard from './components/BudgetsCard';
import SetupChecklist from './components/SetupChecklist';
import CollectionsNowCard from './components/CollectionsNowCard';
import { dateKey } from '../analytics/period';
import { linkToBanking } from '../../lib/deepLinks';

/**
 * Overview — "where am I right now, and what needs my attention?"
 *
 * Read top to bottom, the page is meant to answer seven questions in about
 * thirty seconds:
 *
 *   1. What should I care about today?   → Morning Brief
 *   2. How much am I worth?              → hero
 *   3. What can I actually spend?        → hero
 *   4. Am I on track this month?         → metric band (spending vs usual)
 *   5. How are my holdings doing?        → metric band
 *   6. Did anything post?                → activity card
 *   7. What is waiting on me?            → review card, goals
 *
 * The order is the hierarchy: brief and net worth are primary, the metric band
 * is secondary, accounts and goals are reference. Analytics answers what
 * happened and why; nothing on this page should need a chart to be understood.
 */

export interface OverviewTabProps {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  goals: SavingsGoal[];
  recurring: RecurringTransaction[];
  recurringOverview?: RecurringOverview | null;
  snapshots: MonthSnapshot[];
  assets: Asset[];
  failedSources: string[];
  today: Date;
  budgets?: BudgetProgressSummary | null;
  /** Owner of the per-user setup flags. */
  userId?: number;
  /** Trips, holidays, moves. */
  collections?: Collection[];
  onManageBudgets?: () => void;
}

const OverviewTab: React.FC<OverviewTabProps> = props => {
  const { accounts, goals, failedSources, today } = props;

  const model = useOverviewModel(
    {
      accounts: props.accounts,
      transactions: props.transactions,
      categories: props.categories,
      goals: props.goals,
      recurring: props.recurring,
      recurringOverview: props.recurringOverview ?? null,
      snapshots: props.snapshots,
      assets: props.assets,
      failedSources: props.failedSources,
      collections: props.collections,
    },
    today,
  );

  const goalsFailed = failedSources.includes('savings goals');
  const allocatedToGoals = goalsFailed
    ? 0
    : goals.reduce((sum, g) => sum + (Number(g.current_amount) || 0), 0);

  return (
    <div>
      {/* ── First run ── */}
      {props.userId != null && props.onManageBudgets && (
        <div className="mb-6">
          <SetupChecklist
            userId={props.userId}
            hasAccounts={accounts.length > 0}
            hasBudget={(props.budgets?.budgets.length ?? 0) > 0}
            onSetBudget={props.onManageBudgets}
          />
        </div>
      )}

      {/* ── Primary: what you are worth, then this month in one strip ── */}
      <OverviewHero
        netWorth={model.netWorth}
        availableToSpend={model.availableToSpend}
        totalWealth={model.totalWealth}
        activity={model.activity}
        comparison={model.comparison}
      />

      <MetricRow
        monthName={model.activity.monthName}
        income={model.metrics.income}
        expenses={model.metrics.expenses}
        pace={model.pace}
        physicalAssets={model.physicalAssets}
        investments={model.investments}
        cardDebt={model.cardDebt}
        cardUtilization={model.cardUtilization}
        showAssets={!failedSources.includes('assets')}
        allocatedToGoals={allocatedToGoals}
        goalCount={goalsFailed ? 0 : goals.length}
        recurringMonth={model.recurringMonth}
        recurringCount={model.recurringCount}
      />

      {/* ── Then what needs you, and the reference lists ── */}
      <div className="grid lg:grid-cols-[3fr_2fr] gap-x-12 gap-y-9 pt-8 items-start">
        <div className="space-y-9 min-w-0">
          <MorningBrief
            items={model.brief}
            dateLabel={today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          />
          <ImportReviewCard review={model.review} monthName={model.activity.monthName} />
          <MonthActivityCard
            activity={model.activity}
            nextCharge={model.nextCharge}
            invested={model.metrics.investments}
            showNextCharge={!model.brief.some(item => item.id === 'bill-due')}
          />
        </div>

        <div className="space-y-9 min-w-0">
          <CollectionsNowCard items={model.collections} todayKey={dateKey(today)} />
          {props.onManageBudgets && (
            <BudgetsCard
              summary={props.budgets ?? null}
              today={today}
              onManage={props.onManageBudgets}
              unavailable={failedSources.includes('budgets')}
            />
          )}
          {!goalsFailed && <GoalsList goals={goals} today={today} />}
          <section aria-labelledby="overview-accounts-heading">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="section-title" id="overview-accounts-heading">Accounts</h2>
              <Link to={linkToBanking()} className="section-link">
                View all →
              </Link>
            </div>
            <AccountsGrid accounts={accounts} />
          </section>
        </div>
      </div>
    </div>
  );
};

export default OverviewTab;
