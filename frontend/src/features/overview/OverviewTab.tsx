import React from 'react';
import { Link } from 'react-router-dom';
import type {
  Account,
  Asset,
  Category,
  MonthSnapshot,
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
  snapshots: MonthSnapshot[];
  assets: Asset[];
  failedSources: string[];
  today: Date;
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
      snapshots: props.snapshots,
      assets: props.assets,
      failedSources: props.failedSources,
    },
    today,
  );

  const goalsFailed = failedSources.includes('savings goals');
  const allocatedToGoals = goalsFailed
    ? 0
    : goals.reduce((sum, g) => sum + (Number(g.current_amount) || 0), 0);

  return (
    <div className="space-y-4 md:space-y-5">
      {/* ── Primary ── */}
      <MorningBrief
        items={model.brief}
        dateLabel={today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      />

      <OverviewHero
        netWorth={model.netWorth}
        availableToSpend={model.availableToSpend}
        totalWealth={model.totalWealth}
        activity={model.activity}
        comparison={model.comparison}
      />

      {/* ── Secondary ── */}
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
      />

      <div className="grid md:grid-cols-2 gap-4 md:gap-5 items-start">
        <MonthActivityCard
          activity={model.activity}
          nextCharge={model.nextCharge}
          invested={model.metrics.investments}
          showNextCharge={!model.brief.some(item => item.id === 'bill-due')}
        />
        <ImportReviewCard review={model.review} monthName={model.activity.monthName} />
      </div>

      {/* ── Reference ── */}
      <div className="grid md:grid-cols-[3fr_2fr] gap-4 md:gap-6 items-start">
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="label">Accounts</p>
            <Link to={linkToBanking()} className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
              View all →
            </Link>
          </div>
          <AccountsGrid accounts={accounts} />
        </div>

        {!goalsFailed && <GoalsList goals={goals} today={today} />}
      </div>
    </div>
  );
};

export default OverviewTab;
