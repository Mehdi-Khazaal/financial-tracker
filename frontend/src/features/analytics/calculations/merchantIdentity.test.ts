/**
 * Frontend merchant-identity precedence and legacy fallback.
 *
 * The backend is authoritative: it computes `merchant_key` at write time and
 * exposes it on every transaction. These tests pin that the client prefers the
 * stored answer, and that rows written before the Phase 5A migration — which
 * carry no key at all — still group correctly through the local fallback.
 */

import type { Account, Category, Transaction } from '../../../types';
import { buildClassificationContext } from './transactions';
import {
  merchantDisplayName,
  merchantIdentity,
  merchantKeyOf,
  normalizeMerchantName,
} from './transactions';
import { detectRecurringTransactions } from './recurring';

const CHECKING = 1;

const accounts: Account[] = [
  {
    id: CHECKING, user_id: 1, name: 'Everyday', type: 'checking', balance: 4000,
    credit_limit: null, currency: 'USD', created_at: '', updated_at: '',
  },
];
const categories: Category[] = [];
const ctx = buildClassificationContext(accounts, categories);
const TODAY = new Date('2026-07-20T00:00:00');

let nextId = 1;
const tx = (
  transaction_date: string,
  amount: number,
  description: string | null,
  extra: Partial<Transaction> = {},
): Transaction => ({
  id: nextId++,
  user_id: 1,
  account_id: CHECKING,
  category_id: null,
  amount,
  description,
  transaction_date,
  created_at: '',
  ...extra,
});

describe('merchantIdentity precedence', () => {
  it('prefers the Plaid entity id above everything else', () => {
    const row = tx('2026-07-01', -10, 'SOME RAW STRING', {
      plaid_merchant_entity_id: 'ent_netflix',
      merchant_key: 'netflix',
    });
    expect(merchantIdentity(row)).toBe('plaid:ent_netflix');
  });

  it('namespaces the entity id so it cannot collide with a normalized string', () => {
    const entity = tx('2026-07-01', -10, 'x', { plaid_merchant_entity_id: 'netflix' });
    const stringKeyed = tx('2026-07-01', -10, 'Netflix');
    expect(merchantIdentity(entity)).not.toBe(merchantIdentity(stringKeyed));
  });

  it('falls back to the stored merchant_key when there is no entity id', () => {
    const row = tx('2026-07-01', -10, 'NETFLIX.COM 866-579-7172', { merchant_key: 'netflix' });
    expect(merchantIdentity(row)).toBe('netflix');
  });

  it('falls back to local normalization for a legacy row with neither', () => {
    const row = tx('2026-07-01', -10, 'POS PURCHASE STREAMFLIX 998877');
    expect(merchantIdentity(row)).toBe(normalizeMerchantName('Streamflix'));
  });

  it('treats an empty stored key as absent', () => {
    const row = tx('2026-07-01', -10, 'Streamflix', { merchant_key: '' });
    expect(merchantIdentity(row)).toBe('streamflix');
  });
});

describe('merchantKeyOf', () => {
  it('never returns an entity id, so it stays comparable with declared rows', () => {
    const row = tx('2026-07-01', -10, 'Netflix', {
      plaid_merchant_entity_id: 'ent_netflix',
      merchant_key: 'netflix',
    });
    expect(merchantKeyOf(row)).toBe('netflix');
  });

  it('normalizes locally when the row predates the migration', () => {
    const row = tx('2026-07-01', -10, 'ACH DEBIT STREAMFLIX');
    expect(merchantKeyOf(row)).toBe('streamflix');
  });
});

describe('detection with stored identity', () => {
  it('groups variants the backend already resolved to one key', () => {
    // Three different raw strings, one stored key — the old code grouped on
    // the description and would have seen three separate merchants.
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -15.99, 'NETFLIX.COM', { merchant_key: 'netflix' }),
        tx('2026-06-04', -15.99, 'NETFLIX*MEMBERSHIP', { merchant_key: 'netflix' }),
        tx('2026-07-04', -15.99, 'SQ *NETFLIX', { merchant_key: 'netflix' }),
      ],
      ctx,
      { today: TODAY },
    );
    expect(detected).toHaveLength(1);
    expect(detected[0].occurrences).toBe(3);
  });

  it('groups on the Plaid entity id even when the strings differ wildly', () => {
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -12.5, 'PAYMENT REF 41A', { plaid_merchant_entity_id: 'ent_gym', merchant_key: 'ref a' }),
        tx('2026-06-04', -12.5, 'PAYMENT REF 88B', { plaid_merchant_entity_id: 'ent_gym', merchant_key: 'ref b' }),
        tx('2026-07-04', -12.5, 'PAYMENT REF 03C', { plaid_merchant_entity_id: 'ent_gym', merchant_key: 'ref c' }),
      ],
      ctx,
      { today: TODAY },
    );
    expect(detected).toHaveLength(1);
  });

  it('still works entirely on legacy rows with no stored identity', () => {
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -15.99, 'Streamflix'),
        tx('2026-06-04', -15.99, 'Streamflix'),
        tx('2026-07-04', -15.99, 'Streamflix'),
      ],
      ctx,
      { today: TODAY },
    );
    expect(detected).toHaveLength(1);
  });

  it('suppresses a declared subscription matched by stored key', () => {
    const declared = new Set([normalizeMerchantName('Netflix')]);
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -15.99, 'NETFLIX.COM', { merchant_key: 'netflix' }),
        tx('2026-06-04', -15.99, 'NETFLIX*MEMBERSHIP', { merchant_key: 'netflix' }),
        tx('2026-07-04', -15.99, 'SQ *NETFLIX', { merchant_key: 'netflix' }),
      ],
      ctx,
      { today: TODAY, declaredKeys: declared },
    );
    expect(detected).toHaveLength(0);
  });

  it('suppresses a declared subscription on rows that also carry an entity id', () => {
    // Suppression must work through the string key even when grouping used
    // the entity id — a declared row only has a description.
    const declared = new Set([normalizeMerchantName('Netflix')]);
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -15.99, 'Netflix', { plaid_merchant_entity_id: 'ent_nf', merchant_key: 'netflix' }),
        tx('2026-06-04', -15.99, 'Netflix', { plaid_merchant_entity_id: 'ent_nf', merchant_key: 'netflix' }),
        tx('2026-07-04', -15.99, 'Netflix', { plaid_merchant_entity_id: 'ent_nf', merchant_key: 'netflix' }),
      ],
      ctx,
      { today: TODAY, declaredKeys: declared },
    );
    expect(detected).toHaveLength(0);
  });

  it('keeps unrelated merchants apart when only descriptions are available', () => {
    const detected = detectRecurringTransactions(
      [
        tx('2026-05-04', -15.99, 'Apple Store'),
        tx('2026-06-04', -15.99, 'Apple Bakery'),
        tx('2026-07-04', -15.99, 'Apple Store'),
      ],
      ctx,
      { today: TODAY },
    );
    // Two occurrences each — neither reaches the 3-occurrence threshold.
    expect(detected).toHaveLength(0);
  });
});

describe('display name', () => {
  it('reads from the description, independently of the grouping key', () => {
    // Grouping and labelling are separate concerns: the row groups under the
    // backend's "netflix" key while the label still comes from the text.
    const row = tx('2026-07-01', -10, 'Netflix', { merchant_key: 'netflix' });
    expect(merchantIdentity(row)).toBe('netflix');
    expect(merchantDisplayName(row.description)).toBe('Netflix');
  });

  it('still uses the frozen legacy cleanup, which is weaker than the backend', () => {
    // Documented limitation, not a bug: `merchantDisplayName` runs the legacy
    // frontend normalizer, which does not strip domain suffixes. It only shows
    // for rows Plaid did not enrich — where Plaid supplies `merchant_name`,
    // `description` is already the clean "Netflix".
    expect(merchantDisplayName('NETFLIX.COM')).toBe('Netflix Com');
    // Grouping is unaffected, because that uses the backend's key.
    const row = tx('2026-07-01', -10, 'NETFLIX.COM', { merchant_key: 'netflix' });
    expect(merchantIdentity(row)).toBe('netflix');
  });
});
