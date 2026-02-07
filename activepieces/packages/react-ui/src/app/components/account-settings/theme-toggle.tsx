import { t } from 'i18next';
import { Moon, Palette, Sun } from 'lucide-react';

import { useTheme } from '@/components/theme-provider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium flex items-center gap-2">
        <Palette className="w-4 h-4" />
        {t('Theme')}
      </Label>
      <div className="flex items-center gap-3">
        <Sun className="w-4 h-4 text-muted-foreground" />
        <Switch
          checked={isDark}
          onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          checkedIcon={<Moon className="w-3 h-3 text-primary" />}
          uncheckedIcon={<Sun className="w-3 h-3 text-muted-foreground" />}
          aria-label="Toggle dark mode"
        />
        <Moon className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {isDark ? 'Dark' : 'Light'}
        </span>
      </div>
      {theme === 'system' && (
        <p className="text-xs text-muted-foreground">
          System theme is active. Switching will override it.
        </p>
      )}
    </div>
  );
};

export default ThemeToggle;
