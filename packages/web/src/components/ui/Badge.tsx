import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: 'default' | 'success' | 'warning' | 'error';
};

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-slate-800 text-slate-200',
    success: 'bg-emerald-500/20 text-emerald-200',
    warning: 'bg-amber-500/20 text-amber-200',
    error: 'bg-rose-500/20 text-rose-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
