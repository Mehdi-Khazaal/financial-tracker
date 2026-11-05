import React from 'react';
import type { Collection } from '../../../types';
import { collectionColor } from '../calculations/collections';

/** A collection's mark: its emoji, or a dot in its color. No tile behind it. */
const CollectionBadge: React.FC<{ collection: Pick<Collection, 'emoji' | 'color'>; size?: 'sm' | 'md' | 'lg' }> = ({ collection, size = 'md' }) => {
  const color = collectionColor(collection);
  const box = size === 'lg' ? 'w-10 h-10 text-3xl' : size === 'sm' ? 'w-6 h-6 text-base' : 'w-8 h-8 text-xl';
  return (
    <span className={`${box} shrink-0 inline-flex items-center justify-center`} aria-hidden="true">
      {collection.emoji
        ? <span>{collection.emoji}</span>
        : <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
    </span>
  );
};

export default CollectionBadge;
