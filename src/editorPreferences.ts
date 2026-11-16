import { inject, provide, shallowRef, type InjectionKey } from 'vue';

export const vimPreferenceKey = 'datagoblin.editor.vim';
function savedVim(): boolean {
  try { return localStorage.getItem(vimPreferenceKey) === 'true'; } catch { return false; }
}
function createPreferences() {
  const vim = shallowRef(savedVim());
  const error = shallowRef('');
  return {
    get vim() { return vim.value; },
    get error() { return error.value; },
    setVim(enabled: boolean) {
      vim.value = enabled;
      try { localStorage.setItem(vimPreferenceKey, String(enabled)); error.value = ''; }
      catch { error.value = 'Vim mode applied, but this preference could not be saved.'; }
    },
  };
}
const key: InjectionKey<ReturnType<typeof createPreferences>> = Symbol('Editor preferences');
export function provideEditorPreferences() { provide(key, createPreferences()); }
export const useEditorPreferences = () => inject(key, createPreferences, true);
