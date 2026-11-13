import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
export const themes = [
  { id: 'daylight', name: 'Daylight', description: 'Soft white · clear contrast' },
  { id: 'midnight', name: 'Midnight', description: 'Quiet charcoal · cool blue accent' },
  { id: 'system', name: 'System', description: 'Daylight or Midnight with your device' },
] as const;
export type Theme = typeof themes[number]['id'];
export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem('datagoblin.theme');
    if (saved === 'graphite' || saved === 'goblin') return 'midnight';
    return themes.some(t => t.id === saved) ? saved as Theme : 'system';
  } catch { return 'system'; }
}
const ThemeContext = createContext({ theme: 'system' as Theme, dark: true, setTheme: (_: Theme) => {}, error: '' });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, updateTheme] = useState<Theme>(savedTheme);
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true);
  const [error, setError] = useState('');
  useEffect(() => { const media = window.matchMedia?.('(prefers-color-scheme: dark)'); if (!media) return; const changed = () => setSystemDark(media.matches); media.addEventListener('change', changed); return () => media.removeEventListener('change', changed); }, []);
  const resolved = theme === 'system' ? systemDark ? 'midnight' : 'daylight' : theme;
  useLayoutEffect(() => { document.documentElement.dataset.theme = resolved; }, [resolved]);
  function setTheme(next: Theme) { updateTheme(next); try { localStorage.setItem('datagoblin.theme', next); setError(''); } catch { setError('Theme applied, but could not save this preference.'); } }
  return <ThemeContext.Provider value={{ theme, dark: resolved !== 'daylight', setTheme, error }}>{children}</ThemeContext.Provider>;
}
export const useTheme = () => useContext(ThemeContext);
