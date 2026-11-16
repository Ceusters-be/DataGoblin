import { shallowRef } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
export const storageKey = 'datagoblin.layout';
export const defaultLayout = {
  left: 248,
  right: 248,
  top: 0.62
};
export function savedLayout() {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    if (value && [value.left, value.right, value.top].every(n => typeof n === 'number' && Number.isFinite(n))) return {
      left: Math.max(160, Math.min(500, value.left)),
      right: Math.max(160, Math.min(500, value.right)),
      top: Math.max(0.2, Math.min(0.85, value.top))
    };
  } catch {/* Restore a usable layout when settings are missing or invalid. */}
  return defaultLayout;
}
export function fitLayout(width: number, height: number, layout: typeof defaultLayout) {
  const sideBudget = Math.max(320, width - 16 - 16 - 320);
  let left = Math.min(layout.left, 500),
    right = Math.min(layout.right, 500);
  if (left + right > sideBudget) {
    const excess = left + right - sideBudget;
    const room = left + right - 320;
    left -= excess * (left - 160) / Math.max(1, room);
    right -= excess * (right - 160) / Math.max(1, room);
  }
  const vertical = Math.max(360, height - 24);
  return {
    left: Math.max(160, left),
    right: Math.max(160, right),
    top: Math.max(220, Math.min(vertical - 140, vertical * layout.top)),
    vertical,
    sideBudget
  };
}
export const defaultPanels = {
  explorer: true,
  queries: true,
  results: true
};
export function useWorkspacePanels() {
  const panels = shallowRef((() => {
    try {
      const stored = JSON.parse(localStorage.getItem('datagoblin.panels') ?? 'null');
      return Object.fromEntries(Object.entries(defaultPanels).map(([key, fallback]) => [key, typeof stored?.[key] === 'boolean' ? stored[key] : fallback])) as typeof defaultPanels;
    } catch {
      return defaultPanels;
    }
  })());
  const setPanels = stateSetter(panels);
  watchMounted(() => {
    const _panels = panels.value;
    return [_panels];
  }, () => {
    const _panels2 = panels.value;
    try {
      localStorage.setItem('datagoblin.panels', JSON.stringify(_panels2));
    } catch {/* Panels remain usable without storage. */}
  });
  return {
    get panels() {
      const _panels3 = panels.value;
      return _panels3;
    },
    get togglePanel() {
      return (panel: keyof typeof defaultPanels) => setPanels(current => ({
        ...current,
        [panel]: !current[panel]
      }));
    }
  };
}
