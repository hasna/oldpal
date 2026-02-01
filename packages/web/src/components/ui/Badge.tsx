import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide',
  {
    variants: {
      variant: {
        default: 'bg-slate-800 text-slate-200',
        success: 'bg-emerald-500/20 text-emerald-200',
        warning: 'bg-amber-500/20 text-amber-200',
        error: 'bg-rose-500/20 text-rose-200',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ variant = 'default', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        badgeVariants({ variant }),
        className
      )}
      {...props}
    />
  );
}

export { badgeVariants };
