import React from 'react';

interface Props {
  iconPath: string;
  iconColor?: string;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

const EmptyState: React.FC<Props> = ({
  iconPath, iconColor = 'var(--accent)', title, description, action,
}) => (
  <div className="card py-14 flex flex-col items-center text-center px-6">
    <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
      style={{ backgroundColor: 'oklch(72% 0.17 55 / 0.08)', border: '1px solid oklch(72% 0.17 55 / 0.15)' }}>
      <svg viewBox="0 0 20 20" fill={iconColor} className="w-7 h-7">
        <path d={iconPath} />
      </svg>
    </div>
    <p className="font-semibold text-base mb-1" style={{ color: 'var(--fg)' }}>{title}</p>
    {description && <p className="text-sm max-w-xs leading-relaxed mb-5" style={{ color: 'var(--muted)' }}>{description}</p>}
    {action && !description && <div className="mb-5" />}
    {action && (
      <button onClick={action.onClick} className="btn-gradient px-6 py-2.5 text-sm">
        {action.label}
      </button>
    )}
  </div>
);

export default EmptyState;
