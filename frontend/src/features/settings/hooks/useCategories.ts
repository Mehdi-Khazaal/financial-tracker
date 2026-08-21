import { useCallback, useEffect, useState } from 'react';
import { createCategory, deleteCategory, getCategories, updateCategory } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AsyncCollection, Category, LoadStatus } from '../types';

/**
 * Category list plus the three writes Settings performs against it.
 *
 * `create` and `rename` resolve to an **error message or null** rather than a
 * boolean, because the interesting failure is a duplicate name and that belongs
 * against the name field in the form, not in a toast the user has to read and
 * then re-find the field. The server's message is preferred over an invented
 * one — it already names the type and the clashing name.
 *
 * System categories are absent from these paths on purpose: they are read-only
 * server-side (403), the manager renders no menu for them, and this hook does
 * not need to re-check what neither layer will attempt.
 */

/** Pull a usable message out of an axios error, falling back to `fallback`. */
const errorMessage = (error: any, fallback: string): string => {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  // 422 from Pydantic arrives as a list of field errors; the first one's `msg`
  // is the readable half ("Color must be a hex value like #5b8fff").
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    if (typeof first?.msg === 'string') return first.msg.replace(/^Value error,\s*/, '');
  }
  return fallback;
};

export interface UseCategories extends AsyncCollection<Category> {
  create: (name: string, type: Category['type'], color: string) => Promise<string | null>;
  rename: (id: number, name: string, color: string) => Promise<string | null>;
  remove: (id: number, name: string) => Promise<void>;
}

export function useCategories(): UseCategories {
  const toast = useToast();
  const [items, setItems] = useState<Category[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  const reload = useCallback(async () => {
    setStatus('loading');
    try {
      const response = await getCategories();
      setItems(Array.isArray(response.data) ? response.data : []);
      setStatus('ready');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (name: string, type: Category['type'], color: string) => {
    try {
      await createCategory({ name, type, color });
      await reload();
      toast.success('Category created');
      return null;
    } catch (error: any) {
      return errorMessage(error, 'Failed to create category');
    }
  }, [reload, toast]);

  const rename = useCallback(async (id: number, name: string, color: string) => {
    try {
      await updateCategory(id, { name, color });
      await reload();
      toast.success('Category updated');
      return null;
    } catch (error: any) {
      return errorMessage(error, 'Failed to update category');
    }
  }, [reload, toast]);

  const remove = useCallback(async (id: number, name: string) => {
    // Deliberately generic about volume. Settings does not load transactions,
    // and a count would mean a new endpoint per row for a confirmation dialog;
    // what the user needs to know is the *kind* of consequence, which is exact:
    // both `Transaction.category_id` and `RecurringTransaction.category_id` are
    // ON DELETE SET NULL, so records survive and become uncategorized rather
    // than being moved to some other category.
    const confirmed = await toast.confirm(
      `Delete “${name}”? Any transactions filed under it become uncategorized — `
      + 'they are not deleted, and they are not moved to another category. '
      + 'This cannot be undone.',
      { danger: true },
    );
    if (!confirmed) return;
    try {
      await deleteCategory(id);
      await reload();
      toast.success('Category deleted');
    } catch (error: any) {
      toast.error(errorMessage(error, 'Failed to delete'));
    }
  }, [reload, toast]);

  return { status, items, reload: () => { void reload(); }, create, rename, remove };
}
