import type { Component } from 'vue';
export interface MenuPosition {
  x: number;
  y: number;
  origin: HTMLElement;
}
export interface MenuAction {
  label: string;
  action: () => void;
  disabled?: boolean;
  icon?: Component;
  separator?: boolean;
}
export function menuPosition(event: {
  clientX: number;
  clientY: number;
  currentTarget: EventTarget | null;
}): MenuPosition {
  const rect = (event.currentTarget as HTMLInputElement).getBoundingClientRect();
  return {
    x: event.clientX || rect.left,
    y: event.clientY || rect.bottom,
    origin: (event.currentTarget as HTMLInputElement).matches('button,[tabindex]') ? event.currentTarget as HTMLInputElement : (event.currentTarget as HTMLInputElement).querySelector<HTMLElement>('button,[tabindex]') ?? event.currentTarget as HTMLInputElement
  };
}
