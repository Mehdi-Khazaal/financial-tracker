/**
 * React binding for the persistent mutation queue.
 *
 * `useQueuedMutations(kind?)` subscribes to the queue and returns pending
 * mutations of the given kind. Pages merge these with server data so the
 * user sees their new row before the network round-trip completes.
 */

import { useEffect, useState } from 'react';
import { getPending, subscribe, MutationKind, QueuedMutation } from '../utils/mutationQueue';

export function useQueuedMutations<TSnapshot = any>(kind?: MutationKind): QueuedMutation<any, TSnapshot>[] {
  const [items, setItems] = useState<QueuedMutation[]>(() => getPending());

  useEffect(() => {
    return subscribe(() => setItems(getPending()));
  }, []);

  return kind ? items.filter(m => m.kind === kind) : items;
}
