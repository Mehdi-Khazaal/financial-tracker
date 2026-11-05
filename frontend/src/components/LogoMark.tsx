import React from 'react';

/**
 * The Fintrack mark: four strokes and a cross, the oldest way to keep count.
 *
 * Drawn on a rounded square in the brand blue (a slightly brighter blue in
 * dark mode, so it holds its contrast on a near-black page). The same
 * geometry is used for the favicon and the phone icons in `public/`.
 */
interface Props {
  size?: number;
  className?: string;
  /** Read out by screen readers. Leave empty when a visible "Fintrack" sits next to it. */
  title?: string;
}

const LogoMark: React.FC<Props> = ({ size = 32, className, title }) => {
  // Below 20px four strokes blur together, so the small mark uses three.
  const strokes = size < 20 ? 'M10 9v14M16 9v14M22 9v14' : 'M9 9v14M14 9v14M19 9v14M24 9v14';
  const weight = size < 20 ? 3.2 : size < 28 ? 2.7 : 2.4;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect width="32" height="32" rx="7" style={{ fill: 'var(--logo-bg)' }} />
      <path d={strokes} stroke="#FFFFFF" strokeWidth={weight} strokeLinecap="round" />
      <path d="M6.5 20.5L26 11" stroke="#FFFFFF" strokeWidth={weight} strokeLinecap="round" />
    </svg>
  );
};

export default LogoMark;
