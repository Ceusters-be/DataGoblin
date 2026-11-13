import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';

type Option = { value: string; label: string };
export function Select({ id, label, title, value, options, onChange, disabled = false, searchable = false }: {
  id?: string; label: string; title?: string; value: string; options: Option[];
  onChange: (value: string) => void; disabled?: boolean; searchable?: boolean;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 8, width: 220, maxHeight: 320 });
  const choices = options.filter(option => option.label.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  function close(restore = true) { setOpen(false); if (restore) trigger.current?.focus(); }
  function show() { if (disabled) return; setSearch(''); setActive(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); }
  function choose(option: Option) { onChange(option.value); close(); }
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current!.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, searchable ? 260 : 200), window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const upward = below < 240 && above > below;
      const maxHeight = Math.max(60, Math.min(320, upward ? above : below));
      const height = Math.min(popup.current?.getBoundingClientRect().height || maxHeight, maxHeight);
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), top: upward ? Math.max(8, rect.top - height - 4) : rect.bottom + 4, width, maxHeight });
    }
    place();
    (searchable ? searchInput.current : list.current)?.focus();
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    const scroll = (event: Event) => { if (!popup.current?.contains(event.target as Node)) place(); };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popup.current) observer?.observe(popup.current);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', place); window.removeEventListener('scroll', scroll, true); observer?.disconnect(); };
  }, [open, searchable]);
  useEffect(() => { if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, open, listId]);
  function keys(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'Tab') { close(); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setActive(index => Math.max(0, Math.min(choices.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))));
    } else if (event.key === 'Enter' || (!searchable && event.key === ' ')) {
      event.preventDefault(); if (choices[active]) choose(choices[active]);
    } else if (!searchable && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault(); setActive(event.key === 'Home' ? 0 : Math.max(0, choices.length - 1));
    } else if (!searchable && event.key.length === 1) {
      const index = choices.findIndex(option => option.label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (index >= 0) setActive(index);
    }
  }
  return <>
    <button ref={trigger} id={id} type="button" className="custom-select" role="combobox" aria-label={label} title={title} value={value} disabled={disabled} aria-expanded={open} aria-haspopup="listbox" aria-controls={open ? listId : undefined}
      onClick={() => open ? close() : show()} onKeyDown={event => { if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); show(); } }}>
      <span>{options.find(option => option.value === value)?.label ?? value}</span><ChevronDown size={13}/>
    </button>
    {open && createPortal(<div ref={popup} className="custom-select-popup" style={position} tabIndex={-1} onKeyDown={keys} onPointerDown={event => event.stopPropagation()}>
      {searchable && <div className="custom-select-search"><Search size={14}/><input ref={searchInput} aria-label={`Search ${label.toLowerCase()}`} role="combobox" aria-expanded="true" aria-controls={listId} aria-activedescendant={choices[active] ? `${listId}-${active}` : undefined} placeholder="Search…" value={search} onChange={event => { setSearch(event.target.value); setActive(0); }}/></div>}
      <div ref={list} tabIndex={-1} className="custom-select-options" id={listId} role="listbox" aria-label={label} aria-activedescendant={choices[active] ? `${listId}-${active}` : undefined}>
        {choices.map((option, index) => <div role="option" id={`${listId}-${index}`} key={option.value} aria-selected={option.value === value} className={index === active ? 'highlighted' : ''} onMouseMove={() => setActive(index)} onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}><span>{option.label}</span>{option.value === value && <Check size={14}/>}</div>)}
        {!choices.length && <div className="custom-select-empty">No matches</div>}
      </div>
    </div>, document.body)}
  </>;
}
