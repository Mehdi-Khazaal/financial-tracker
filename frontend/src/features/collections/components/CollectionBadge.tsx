import React from 'react';
import type { Collection } from '../../../types';
import { collectionColor } from '../calculations/collections';

/** The square icon of a collection: its emoji on its color, or a dot. */
const CollectionBadge: React.FC<{ collection: Pick<Collection, 'emoji' | 'color'>; size?: 'sm' | 'md' | 'lg' }> = ({ collection, size = 'md' }) => {
  const color = collectionColor(collection);
  const box = size === 'lg' ? 'w-12 h-12 text-2xl rounded-xl' : size === 'sm' ? 'w-7 h-7 text-sm rounded-lg' : 'w-10 h-10 text-lg rounded-xl';
  return (
    <span
      className={`${box} shrink-0 inline-flex items-center justify-center`}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 16%, transparent)`, border: `1px solid color-mix(in oklab, ${color} 30%, transparent)` }}
      aria-hidden="true"
    >
      {collection.emoji
        ? <span>{collection.emoji}</span>
        : <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />}
    </span>
  );
};

export default CollectionBadge;
