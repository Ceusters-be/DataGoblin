import { isTauri } from '@tauri-apps/api/core';
export function hasCustomTitlebar() {
  return isTauri() && /Win/i.test(navigator.platform);
}
