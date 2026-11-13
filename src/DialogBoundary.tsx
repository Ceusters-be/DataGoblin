import { useEffect, useRef, type ReactNode } from 'react';
const stack: symbol[] = [];
export function DialogBoundary({ children, onClose, disabled = false }: { children: ReactNode; onClose: () => void; disabled?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const current = useRef({ onClose, disabled }); current.current = { onClose, disabled };
  useEffect(() => {
    const token = Symbol(); stack.push(token);
    const origin = document.activeElement as HTMLElement | null;
    const dialog = host.current?.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]') ?? [])].filter(e => !e.closest('[hidden]') && (!e.closest('details:not([open])') || e.tagName === 'SUMMARY'));
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (stack.at(-1) !== token) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!current.current.disabled) current.current.onClose(); }
      if (event.key === 'Tab') {
        const items = focusable(), first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (!dialog?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { stack.splice(stack.indexOf(token), 1); document.removeEventListener('keydown', key, true); if (origin?.isConnected) origin.focus(); };
  }, []);
  return <div ref={host} style={{ display: 'contents' }}>{children}</div>;
}
