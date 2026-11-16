import { type InjectionKey } from 'vue';
import { computed, inject, onBeforeUnmount, onMounted, provide, shallowRef, watch } from 'vue';
export const themes = [{
  id: 'daylight',
  name: 'Daylight',
  description: 'Soft white · clear contrast'
}, {
  id: 'midnight',
  name: 'Midnight',
  description: 'Quiet charcoal · cool blue accent'
}, {
  id: 'system',
  name: 'System',
  description: 'Daylight or Midnight with your device'
}] as const;
export type Theme = typeof themes[number]['id'];
export function savedTheme(): Theme {
  try {
    const saved = localStorage.getItem('datagoblin.theme');
    if (saved === 'graphite' || saved === 'goblin') return 'midnight';
    return themes.some(t => t.id === saved) ? saved as Theme : 'system';
  } catch {
    return 'system';
  }
}
type ThemeState = {
  readonly theme: Theme;
  readonly dark: boolean;
  readonly error: string;
  setTheme: (theme: Theme) => void;
};
const themeKey: InjectionKey<ThemeState> = Symbol('DataGoblin theme');
export function provideTheme() {
  const theme = shallowRef<Theme>(savedTheme());
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  const systemDark = shallowRef(media?.matches ?? true);
  const error = shallowRef('');
  const resolved = computed(() => theme.value === 'system' ? systemDark.value ? 'midnight' : 'daylight' : theme.value);
  const changed = () => {
    systemDark.value = media?.matches ?? true;
  };
  onMounted(() => media?.addEventListener('change', changed));
  onBeforeUnmount(() => media?.removeEventListener('change', changed));
  watch(resolved, value => {
    document.documentElement.dataset.theme = value;
  }, {
    immediate: true,
    flush: 'sync'
  });
  provide(themeKey, {
    get theme() {
      return theme.value;
    },
    get dark() {
      return resolved.value !== 'daylight';
    },
    get error() {
      return error.value;
    },
    setTheme(next) {
      theme.value = next;
      try {
        localStorage.setItem('datagoblin.theme', next);
        error.value = '';
      } catch {
        error.value = 'Theme applied, but could not save this preference.';
      }
    }
  });
}
export const useTheme = () => inject(themeKey, {
  theme: 'system',
  dark: true,
  error: '',
  setTheme: (_: Theme) => {}
});
