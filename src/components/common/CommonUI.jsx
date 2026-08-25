import React from 'react';
import { motion } from 'framer-motion';

/**
 * UserAvatar: Initials-based avatar or uploaded photo on a clean circle
 */
export function UserAvatar({ name = '', avatar = '', size = 'md', className = '' }) {
  const [imgError, setImgError] = React.useState(false);
  const cleanName = (name || '').trim();
  const initials = cleanName
    ? cleanName
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map(part => part[0])
        .join('')
        .toUpperCase()
    : 'U';

  const sizeClasses = {
    xs: 'w-6 h-6 text-[10px]',
    sm: 'w-7 h-7 text-xs',
    md: 'w-8 h-8 text-xs font-semibold',
    lg: 'w-10 h-10 text-sm font-semibold',
    xl: 'w-12 h-12 text-base font-semibold',
    '2xl': 'w-16 h-16 text-xl font-bold',
  };

  const hasValidAvatar = avatar && typeof avatar === 'string' && avatar.trim().length > 0 && !imgError;

  return (
    <div
      className={`rounded-full flex items-center justify-center select-none bg-slate-100 text-slate-700 border border-slate-200/80 shrink-0 overflow-hidden relative ${sizeClasses[size] || sizeClasses.md} ${className}`}
      aria-label={cleanName || 'User avatar'}
    >
      {hasValidAvatar ? (
        <img
          src={avatar}
          alt={cleanName || 'User avatar'}
          onError={() => setImgError(true)}
          className="w-full h-full object-cover rounded-full"
          loading="lazy"
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}

/**
 * LiveIndicator: Small pulsing dot with status text
 */
export function LiveIndicator({ connected = true, label = '' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium select-none">
      <span className="relative flex h-2 w-2">
        {connected && (
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${connected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
      </span>
      {label && <span className={connected ? 'text-slate-700' : 'text-slate-400'}>{label}</span>}
    </span>
  );
}

/**
 * StatusBadge: Semantic pill badge for status tags
 */
export function StatusBadge({ status = '', variant = '' }) {
  let badgeClass = 'badge-neutral';
  const s = (status || '').toLowerCase();

  if (variant === 'success' || s.includes('inside') || s.includes('registered') || s.includes('active') || s.includes('on time') || s.includes('check_in') || s.includes('verified') || s.includes('allowed') || s.includes('approved')) {
    badgeClass = 'badge-success';
  } else if (variant === 'danger' || variant === 'error' || s.includes('unauthorized') || s.includes('alert') || s.includes('spoof') || s.includes('denied') || s.includes('blocked') || s.includes('danger')) {
    badgeClass = 'badge-error';
  } else if (variant === 'warning' || s.includes('late') || s.includes('outside') || s.includes('pending') || s.includes('warning')) {
    badgeClass = 'badge-warning';
  } else if (variant === 'info' || s.includes('check_out') || s.includes('exit') || s.includes('offline')) {
    badgeClass = 'badge-info';
  }

  return (
    <span className={`ui-badge ${badgeClass}`}>
      {status}
    </span>
  );
}

/**
 * EmptyState: Clean line-art illustration + description
 */
export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center select-none">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-400 mb-3 shadow-sm">
          <Icon className="w-6 h-6 stroke-[1.5]" />
        </div>
      )}
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      {description && <p className="mt-1 text-xs text-slate-500 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/**
 * SkeletonLoaders: Modern skeleton boxes for data loading states
 */
export function SkeletonCard() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-3 w-24 skeleton-box" />
        <div className="h-8 w-8 rounded-lg skeleton-box" />
      </div>
      <div className="h-7 w-20 skeleton-box" />
      <div className="h-2 w-32 skeleton-box" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }) {
  return (
    <div className="w-full space-y-3 p-4">
      <div className="h-8 w-full skeleton-box rounded-lg" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 w-full skeleton-box rounded-lg" />
      ))}
    </div>
  );
}
