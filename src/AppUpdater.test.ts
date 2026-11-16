// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/vue';
import AppUpdater from './AppUpdater.vue';
const mocks = vi.hoisted(() => ({ check: vi.fn(), relaunch: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check: mocks.check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: mocks.relaunch }));
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
function available() {
  const update = { version: '0.2.0', download: vi.fn().mockResolvedValue(undefined), install: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined) };
  mocks.check.mockResolvedValue(update);
  return update;
}
it('downloads without installing and saves before installing and relaunching', async () => {
  const update = available();
  const save = vi.fn().mockResolvedValue(undefined);
  render(AppUpdater, { props: { blocked: false, beforeInstall: save } });
  await fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  await screen.findByRole('button', { name: 'Restart to update' });
  expect(update.install).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  await waitFor(() => expect(mocks.relaunch).toHaveBeenCalledOnce());
  expect(save.mock.invocationCallOrder[0]).toBeLessThan(update.install.mock.invocationCallOrder[0]!);
});
it('keeps the downloaded update when saving fails and allows a retry', async () => {
  const update = available();
  const save = vi.fn().mockRejectedValueOnce(new Error('Disk full')).mockResolvedValue(undefined);
  render(AppUpdater, { props: { blocked: false, beforeInstall: save } });
  await fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Restart to update' }));
  await screen.findByTitle(/Disk full/);
  expect(update.install).not.toHaveBeenCalled();
  await fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
  await waitFor(() => expect(update.install).toHaveBeenCalledOnce());
});
it('prevents installation while work or pending grid edits block restarting', async () => {
  const update = available();
  const save = vi.fn();
  const view = render(AppUpdater, { props: { blocked: true, beforeInstall: save } });
  await fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  const restart = await screen.findByRole('button', { name: 'Restart to update' });
  expect((restart as HTMLButtonElement).disabled).toBe(true);
  expect(update.install).not.toHaveBeenCalled();
  await view.rerender({ blocked: false });
  expect((restart as HTMLButtonElement).disabled).toBe(false);
});
it('lets users retry failed downloads without installing partial data', async () => {
  const update = available();
  update.download.mockRejectedValueOnce(new Error('Offline'));
  render(AppUpdater, { props: { blocked: false, beforeInstall: vi.fn() } });
  await fireEvent.click(screen.getByRole('button', { name: 'Updates' }));
  await fireEvent.click(await screen.findByRole('button', { name: 'Retry update' }));
  await screen.findByRole('button', { name: 'Restart to update' });
  expect(update.close).toHaveBeenCalledOnce();
  expect(update.install).not.toHaveBeenCalled();
});
