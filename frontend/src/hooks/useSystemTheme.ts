import { useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'midnight' | 'aleo';
type SystemTheme = 'light' | 'dark';

/**
 * Hook to detect and respond to system color scheme preference
 *
 * @returns Current system theme ('light' or 'dark')
 */
export function useSystemTheme(): SystemTheme {
  const [systemTheme, setSystemTheme] = useState<SystemTheme>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
    // Legacy browsers
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handler);
      return () => mediaQuery.removeListener(handler);
    }
  }, []);

  return systemTheme;
}

/**
 * Applies theme to document root
 *
 * @param theme - Theme to apply ('light', 'dark', 'midnight', 'aleo', or 'system')
 * @param systemTheme - Current system theme (used when theme is 'system')
 */
export function applyTheme(theme: Theme | 'system', systemTheme?: SystemTheme) {
  const root = document.documentElement;

  // Remove all theme attributes first
  root.removeAttribute('data-theme');

  // Apply new theme
  if (theme === 'system') {
    const effectiveTheme = systemTheme || 'light';
    if (effectiveTheme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    }
    // light is default, no attribute needed
  } else if (theme !== 'light') {
    root.setAttribute('data-theme', theme);
  }
}
