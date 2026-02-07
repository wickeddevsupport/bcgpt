import { cn } from '../lib/utils';

type ShowPoweredByProps = {
  show: boolean;
  position?: 'sticky' | 'absolute' | 'static';
};
const ShowPoweredBy = ({ show, position = 'sticky' }: ShowPoweredByProps) => {
  if (!show) {
    return null;
  }
  return (
    <div
      className={cn('bottom-3 right-5 pointer-events-none z-10000', position, {
        '-mt-[30px]': position === 'sticky',
        'mr-5': position === 'sticky',
      })}
    >
      <div
        className={cn(
          'justify-end p-1 text-muted-foreground/70 text-sm items-center flex gap-1 transition group ',
          {
            'justify-center': position === 'static',
          },
        )}
      >
        <div className=" text-sm transition">Built with</div>
        <div className="justify-center flex items-center gap-1">
          <img
            src="/branding/wicked-flow-icon.svg"
            alt="Wicked Flow"
            className="h-4 w-4 opacity-70"
          />
          <div className="font-semibold">Wicked Flow</div>
        </div>
      </div>
    </div>
  );
};

ShowPoweredBy.displayName = 'ShowPoweredBy';
export { ShowPoweredBy };
