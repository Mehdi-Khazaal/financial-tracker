import React, { useContext } from 'react';
import { Link } from 'react-router-dom';
import { TabContext } from '../../context/TabContext';
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
import OverviewHero from './components/OverviewHero';
import StatusInsightCard from './components/StatusInsightCard';
import MonthActivityCard from './components/MonthActivityCard';
import ImportReviewCard from './components/ImportReviewCard';
import AccountsGrid from './components/AccountsGrid';
import GoalsList from './components/GoalsList';

/**
 * Overview — "where am I right now, and what needs my attention?"
 *
 * Analytics answers what happened and why. This tab deliberately holds a much
 * smaller set of things: the current position, whether new activity has landed,
 * what changed, and the single next thing worth looking at. Anything that
 * wanted a chart or a ranked list belongs on the other tab.
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
  const { setRouteTab } = useContext(TabContext);

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

  return (
    <>
      <OverviewHero
        netWorth={model.netWorth}
        availableToSpend={model.availableToSpend}
        income={model.metrics.income}
        expenses={model.metrics.expenses}
        physicalAssets={model.physicalAssets}
        investments={model.investments}
        activity={model.activity}
        comparison={model.comparison}
        showAssets={!failedSources.includes('assets')}
        monthName={model.activity.monthName}
      />

      <StatusInsightCard insight={model.insight} />

      {/* Two compact status modules where Transfer / Withdraw / Deposit were. */}
      <div className="grid md:grid-cols-2 gap-4 md:gap-5 items-start">
        <MonthActivityCard activity={model.activity} nextCharge={model.nextCharge} />
        <ImportReviewCard review={model.review} monthName={model.activity.monthName} />
      </div>

      <div className="grid md:grid-cols-[3fr_2fr] gap-6 items-start">
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="label">Accounts</p>
            <Link
              to="/accounts"
              onClick={() => setRouteTab('/accounts', 'wallet')}
              className="text-xs font-medium"
              style={{ color: 'var(--accent)' }}
            >
              View all →
            </Link>
          </div>
          <AccountsGrid accounts={accounts} />
        </div>

        <div className="space-y-6">
          {!goalsFailed && <GoalsList goals={goals} today={today} />}
        </div>
      </div>
    </>
  );
};

export default OverviewTab;
