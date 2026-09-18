/**
 * Frontend merchant-identity precedence and legacy fallback.
 *
 * The backend is authoritative: it computes `merchant_key` at write time and
 * exposes it on every transaction. These tests pin that the client prefers the
 * stored answer, and that rows written before the Phase 5A migration — which
 * carry no key at all — still group correctly through the local fallback.
 */

import type { Transaction } from '../../../types';
import {
  merchantDisplayName,
  merchantIdentity,
  merchantKeyOf,
  normalizeMerchantName,
} from './transactions';

const CHECKING = 1;

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
