import { cn } from '@/utils/cn';

/** DTII brand mark with the product name. `dark` renders for the navy sidebar / auth panel. */
export function Logo({ dark, className }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <img src="/logo-mark.svg" alt="" width={28} height={29} />
      <div className="leading-tight">
        <div className={cn('text-[15px] font-semibold tracking-tight', dark ? 'text-white' : 'text-foreground')}>DTII</div>
        <div className={cn('text-[11px] font-medium uppercase tracking-[0.14em]', dark ? 'text-sidebar-foreground/70' : 'text-muted-foreground')}>
          Valuers Ecosystem
        </div>
      </div>
    </div>
  );
}
