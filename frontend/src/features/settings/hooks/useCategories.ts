import { useCallback, useEffect, useState } from 'react';
import { createCategory, deleteCategory, getCategories, updateCategory } from '../../../utils/api';
import { useToast } from '../../../context/ToastContext';
import type { AsyncCollection, Category, LoadStatus } from '../types';

/**
 * Category list plus the three writes Settings performs against it.
 *
 * Behaviour is carried over from the page unchanged — Phase 6B owns the
 * Category Manager redesign, and this extraction deliberately changes nothing
 * a user could notice. The one thing worth stating here rather than leaving
 * implicit: **system categories are immutable**. `update_category` and
 * `delete_category` filter on `user_id == current_user.id` and system rows
 * carry a null `user_id`, so any write against one 404s. The section renders
 * no controls for them; this hook does not need to re-check.
 */
export interface UseCategories extends AsyncCollection<Category> {
  create: (name: string, type: Category['type'], color: string) => Promise<boolean>;
  rename: (id: number, name: string, color: string) => Promise<boolean>;
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
      return true;
    } catch {
      toast.error('Failed to create category');
      return false;
    }
  }, [reload, toast]);

  const rename = useCallback(async (id: number, name: string, color: string) => {
    try {
      await updateCategory(id, { name, color });
      await reload();
      toast.success('Category updated');
      return true;
    } catch {
      toast.error('Failed to update category');
      return false;
    }
  }, [reload, toast]);

  const remove = useCallback(async (id: number, name: string) => {
    const confirmed = await toast.confirm(
      `Delete "${name}"? Transactions using it will lose their category.`,
      { danger: true },
    );
    if (!confirmed) return;
    try {
      await deleteCategory(id);
      await reload();
      toast.success('Category deleted');
    } catch {
      toast.error('Failed to delete');
    }
  }, [reload, toast]);

  return { status, items, reload: () => { void reload(); }, create, rename, remove };
}
