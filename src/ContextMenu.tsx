import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
export interface MenuPosition { x: number; y: number; origin: HTMLElement }
export interface MenuAction { label: string; action: () => void; disabled?: boolean; icon?: ReactNode; separator?: boolean }
export function menuPosition(event: { clientX: number; clientY: number; currentTarget: EventTarget & HTMLElement }): MenuPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX || rect.left, y: event.clientY || rect.bottom, origin: event.currentTarget.matches('button,[tabindex]') ? event.currentTarget : event.currentTarget.querySelector<HTMLElement>('button,[tabindex]') ?? event.currentTarget };
}
export function ContextMenu({ position, label, actions, onClose }: { position: MenuPosition; label: string; actions: MenuAction[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [point, setPoint] = useState({ left: position.x, top: position.y });
  useLayoutEffect(() => {
    const node = ref.current!;
    const place = () => { const rect = node.getBoundingClientRect(); setPoint({ left: Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8)) }); };
    place(); node.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) onClose(); };
    window.addEventListener('resize', place); document.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('resize', place); document.removeEventListener('pointerdown', outside); };
  }, [position]);
  function dismiss() { onClose(); if (position.origin.isConnected) position.origin.focus(); }
  return createPortal(<div ref={ref} role="menu" aria-label={label} className="context-menu" style={point} onContextMenu={event => event.preventDefault()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
    else if (event.key === 'Tab') dismiss();
    else if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault(); const buttons = Array.from(ref.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[index]?.focus();
    }
  }}>{actions.map(item => <div key={item.label}>{item.separator && <div role="separator"/>}<button type="button" role="menuitem" disabled={item.disabled} onClick={() => { dismiss(); item.action(); }}><span className="menu-icon">{item.icon}</span><span>{item.label}</span></button></div>)}</div>, document.body);
}
