import { useCallback, useEffect, useState } from 'react';
import { applyRule, createRule, deleteRule, getRules, updateRule } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AsyncCollection, LoadStatus } from '../types';
import type { CategorizationRule, RuleDraft } from '../../../types';

/**
 * Categorization rules plus the writes Settings performs against them.
 *
 * `create` and `edit` resolve to an error message or null, like the category
 * hook, because the interesting failure — an invalid regular expression — is
 * something to show against the pattern field, not in a toast.
 */
const errorMessage = (error: any, fallback: string): string => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (Array.isArray(detail) && detail.length > 0 && typeof detail[0]?.msg === 'string') {
    return detail[0].msg.replace(/^Value error,\s*/, '');
  }
  return fallback;
};

export interface UseRules extends AsyncCollection<CategorizationRule> {
  create: (draft: RuleDraft) => Promise<string | null>;
  edit: (id: number, changes: Partial<RuleDraft>) => Promise<string | null>;
  toggle: (rule: CategorizationRule) => Promise<void>;
  remove: (rule: CategorizationRule, label: string) => Promise<void>;
  /** Apply to past transactions; resolves to how many changed, or null on failure. */
  applyToPast: (rule: CategorizationRule, label: string) => Promise<number | null>;
}

export function useRules(): UseRules {
  const toast = useToast();
  const [items, setItems] = useState<CategorizationRule[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await getRules();
      setItems(Array.isArray(response.data) ? response.data : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (draft: RuleDraft) => {
    try {
      await createRule(draft);
      await reload();
      toast.success('Rule saved');
      return null;
    } catch (error: any) {
      return errorMessage(error, 'The rule could not be saved');
    }
  }, [reload, toast]);

  const edit = useCallback(async (id: number, changes: Partial<RuleDraft>) => {
    try {
      await updateRule(id, changes);
      await reload();
      toast.success('Rule updated');
      return null;
    } catch (error: any) {
      return errorMessage(error, 'The rule could not be updated');
    }
  }, [reload, toast]);

  const toggle = useCallback(async (rule: CategorizationRule) => {
    try {
      await updateRule(rule.id, { is_active: !rule.is_active });
      await reload();
    } catch (error: any) {
      toast.error(errorMessage(error, 'The rule could not be updated'));
    }
  }, [reload, toast]);

  const remove = useCallback(async (rule: CategorizationRule, label: string) => {
    const confirmed = await toast.confirm(
      `Remove the rule “${label}”? Transactions it already filed keep their category.`,
      { title: 'Remove rule', danger: true },
    );
    if (!confirmed) return;
    try {
      await deleteRule(rule.id);
      await reload();
      toast.success('Rule removed');
    } catch (error: any) {
      toast.error(errorMessage(error, 'The rule could not be removed'));
    }
  }, [reload, toast]);

  const applyToPast = useCallback(async (rule: CategorizationRule, label: string) => {
    const confirmed = await toast.confirm(
      `Apply “${label}” to past transactions? Uncategorised and automatically filed matches move; anything you categorised by hand is left alone.`,
      { title: 'Apply to past', danger: false },
    );
    if (!confirmed) return null;
    try {
      const response = await applyRule(rule.id);
      const changed = Number(response.data?.changed ?? 0);
      await reload();
      toast.success(changed === 0 ? 'Nothing left to change' : `${changed} transaction${changed === 1 ? '' : 's'} filed`);
      return changed;
    } catch (error: any) {
      toast.error(errorMessage(error, 'The rule could not be applied'));
      return null;
    }
  }, [reload, toast]);

  return { status, items, reload: () => { void reload(); }, create, edit, toggle, remove, applyToPast };
}
