import { useId, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, Palette, X } from 'lucide-react';
import { themes, useTheme } from './theme';
import { DialogBoundary } from './DialogBoundary';
import type { QueryLibrary } from './types';

export function QuerySettings({ library, onChange, onClose }: { library: QueryLibrary | null; onChange: (folder: string | null) => Promise<void>; onClose: () => void }) {
  const [section, setSection] = useState<'appearance' | 'storage'>('appearance');
  const id = useId();
  const { theme, setTheme, error: themeError } = useTheme();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function change(reset: boolean) {
    setBusy(true); setError('');
    try {
      const folder = reset ? null : await open({ directory: true, multiple: false, title: 'Choose your query library folder', defaultPath: library?.folder });
      if (!reset && !folder) return;
      await onChange(folder);
    } catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  }
  return <DialogBoundary onClose={onClose} disabled={busy}><div className="overlay"><section className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
    <div className="modal-heading"><h2>Settings</h2><button className="icon-button" title="Close settings" disabled={busy} onClick={onClose}><X size={18}/></button></div>
    <div className="settings-layout">
      <nav className="settings-nav" role="tablist" aria-label="Settings categories" aria-orientation="vertical" onKeyDown={event => {
        if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'appearance' : event.key === 'End' ? 'storage' : section === 'appearance' ? 'storage' : 'appearance';
        setSection(next); document.getElementById(`${id}-${next}-tab`)?.focus();
      }}>
        <button id={`${id}-appearance-tab`} role="tab" aria-selected={section === 'appearance'} aria-controls={`${id}-appearance-panel`} tabIndex={section === 'appearance' ? 0 : -1} onClick={() => setSection('appearance')}><Palette size={16}/>Appearance</button>
        <button id={`${id}-storage-tab`} role="tab" aria-selected={section === 'storage'} aria-controls={`${id}-storage-panel`} tabIndex={section === 'storage' ? 0 : -1} onClick={() => setSection('storage')}><FolderOpen size={16}/>Query storage</button>
      </nav>
      <div className="settings-content">
      <section role="tabpanel" id={`${id}-appearance-panel`} aria-labelledby={`${id}-appearance-tab`} hidden={section !== 'appearance'} tabIndex={0}>
    <h3>Appearance</h3>
    <div className="theme-options" role="group" aria-label="Theme">{themes.map(option => <button key={option.id} className="theme-option" aria-label={option.name} aria-pressed={theme === option.id} onClick={() => setTheme(option.id)}>
      <span className="theme-preview" data-palette={option.id} aria-hidden="true"><i/><span><b/><b/><b/></span></span><strong>{option.name}</strong><small>{option.description}</small>
    </button>)}</div>
    <p className="theme-preference-note">Applied immediately across the workspace and remembered on this device.</p>
    {themeError && <p role="alert">{themeError}</p>}
      </section>
      <section role="tabpanel" id={`${id}-storage-panel`} aria-labelledby={`${id}-storage-tab`} hidden={section !== 'storage'} tabIndex={0}>
    <h3>Query storage</h3>
    <p>Query1, Query2… drafts save automatically in Unsaved. Named queries are organized by server and database.</p>
    <label>Current folder<input aria-label="Current query folder" readOnly value={library?.folder ?? 'Library unavailable'}/></label>
    <p className="muted">Default: {library?.defaultFolder ?? 'DataGoblin app data / queries'}</p>
    <p className="muted">Changing folders copies your saved query library to the new location. Original files are kept. Imported SQL files are copied into the library; exporting a file creates a separate copy.</p>
    {error && <div className="form-message error" role="alert">{error}</div>}
    <div className="modal-footer"><button className="secondary-button" disabled={busy || !library} onClick={() => void change(true)}>Use app data folder</button><button className="primary-button" disabled={busy || !library} onClick={() => void change(false)}><FolderOpen size={15}/>{busy ? 'Updating…' : 'Choose folder'}</button></div>
      </section>
      </div>
    </div>
  </section></div></DialogBoundary>;
}
