import { ResultSet } from './types';
import { Engine } from './types';
import { type OutputEvent } from './QueryOutput';
import { shallowRef, computed, watchSyncEffect } from 'vue';
import { stateSetter, watchMounted } from './vueLifecycle';
import { nowForColumn } from './dateCell';
import { sqlEvent } from './QueryOutput';
import { invoke } from '@tauri-apps/api/core';
import { formatCellJson } from './cellValue';
type Change = {
  rowIndex: number;
  column: string;
  value: string | null;
};
type InsertColumn = {
  name: string;
  generated: boolean;
  nullable: boolean;
  defaultExpression?: string | null;
  editable: boolean;
};
const rowDrafts = new Map<string, {
  added: number[];
  deleted: number[];
}>();
type Statement = {
  sql: string;
  parameters: string[];
};
// Keep drafts when another query tab is selected. Cache IDs identify execution snapshots.
const drafts = new Map<string, Change[]>();
const pages = new Map<string, {
  offset: number;
  size: number;
  rows: ResultSet['rows'];
}>();
export function discardEditingDraft(cacheId: string) {
  drafts.delete(cacheId);
  rowDrafts.delete(cacheId);
  pages.delete(cacheId);
}
export const editingPage = (cacheId?: string | null) => cacheId ? pages.get(cacheId) : undefined;
export function useGridEditing(_props: {
  onLog?: (event: OutputEvent) => void;
  logDatabase?: string;
  onMove?: (row: number, column: number, key: string, shift?: boolean) => void;
  cacheId?: string | null;
  data: ResultSet;
  rowOffset: number;
  enabled: boolean;
  blocked?: boolean;
  engine: Engine;
  onDirty?: (dirty: boolean) => void;
  onReload?: () => Promise<void>;
}) {
  const cacheId = computed(() => _props.cacheId);
  const data = computed(() => _props.data);
  const rowOffset = computed(() => _props.rowOffset);
  const enabled = computed(() => _props.enabled);
  const blocked = computed(() => _props.blocked);
  const engine = computed(() => _props.engine);
  const onDirty = computed(() => _props.onDirty);
  const onReload = computed(() => _props.onReload);
  const onMove = computed(() => _props.onMove);
  const onLog = computed(() => _props.onLog);
  const logDatabase = computed(() => _props.logDatabase);
  const changes = shallowRef<Change[]>((() => {
    const _cacheId = cacheId.value;
    return drafts.get(_cacheId ?? '') ?? [];
  })());
  const setChanges = stateSetter(changes);
  const added = shallowRef<number[]>((() => {
    const _cacheId2 = cacheId.value;
    return rowDrafts.get(_cacheId2 ?? '')?.added ?? [];
  })());
  const setAdded = stateSetter(added);
  const deleted = shallowRef<number[]>((() => {
    const _cacheId3 = cacheId.value;
    return rowDrafts.get(_cacheId3 ?? '')?.deleted ?? [];
  })());
  const setDeleted = stateSetter(deleted);
  const insertColumns = shallowRef<InsertColumn[]>([]);
  const setInsertColumns = stateSetter(insertColumns);
  const nextRow = shallowRef(Math.max(data.value.rows.length, ...added.value.map(r => r + 1)));
  const pendingCount = computed(() => {
    const _changes = changes.value;
    const _data = data.value;
    const _rowOffset = rowOffset.value;
    const _added = added.value;
    const _deleted = deleted.value;
    return _changes.filter(c => c.rowIndex < _data.rows.length + _rowOffset).length + _added.length + _deleted.length;
  });
  const allowed = shallowRef<string[]>([]);
  const rowIdentityColumns = shallowRef<Record<string, string[]>>({});
  const setAllowed = stateSetter(allowed);
  const dateColumns = shallowRef<Record<string, string>>({});
  const setDateColumns = stateSetter(dateColumns);
  const uuidColumns = shallowRef<string[]>([]);
  const setUuidColumns = stateSetter(uuidColumns);
  const jsonColumns = shallowRef<string[]>([]);
  const setJsonColumns = stateSetter(jsonColumns);
  const closingInline = shallowRef(false);
  const inspecting = shallowRef(false);
  const cellError = shallowRef('');
  const setCellError = stateSetter(cellError);
  const reason = shallowRef('');
  const setReason = stateSetter(reason);
  const cell = shallowRef<{
    row: number;
    column: number;
    text: string;
    null: boolean;
    json: boolean;
    replace: boolean;
  } | null>(null);
  const setCell = stateSetter(cell);
  const preview = shallowRef<Statement[] | null>(null);
  const setPreview = stateSetter(preview);
  const busy = shallowRef(false);
  const setBusy = stateSetter(busy);
  const submitted = shallowRef(false);
  const setSubmitted = stateSetter(submitted);
  const message = shallowRef('');
  const setMessage = stateSetter(message);
  const callback = shallowRef(onDirty.value);
  watchSyncEffect(() => {
    const _onDirty = onDirty.value;
    return callback.value = _onDirty;
  });
  watchMounted(() => {
    const _cacheId4 = cacheId.value;
    const _enabled = enabled.value;
    return [_cacheId4, _enabled];
  }, () => {
    const _enabled2 = enabled.value;
    const _cacheId5 = cacheId.value;
    let current = true;
    if (_enabled2 && _cacheId5) void invoke<{
      columns: string[];
      jsonColumns?: string[];
      uuidColumns?: string[];
      dateColumns?: Record<string, string>;
      insertColumns?: InsertColumn[];
      rowIdentityColumns?: Record<string, string[]>;
    }>('edit_capabilities', {
      cacheId: _cacheId5
    }).then(result => {
      if (current) {
        setInsertColumns(result?.insertColumns ?? []);
        rowIdentityColumns.value = result?.rowIdentityColumns ?? {};
        setAllowed(result?.columns ?? []);
        setJsonColumns(result?.jsonColumns ?? []);
        setUuidColumns(result?.uuidColumns ?? []);
        setDateColumns(result?.dateColumns ?? {});
        setReason(result?.columns.length ? '' : 'No editable columns.');
      }
    }).catch(error => {
      if (current) setReason(String(error));
    });
    return () => {
      current = false;
    };
  });
  watchMounted(() => {
    const _changes2 = changes.value;
    const _added2 = added.value;
    const _deleted2 = deleted.value;
    const _busy = busy.value;
    const _cell = cell.value;
    const _cacheId6 = cacheId.value;
    return [_changes2, _added2, _deleted2, _busy, _cell, _cacheId6];
  }, () => {
    const _cacheId7 = cacheId.value;
    const _pendingCount = pendingCount.value;
    const _added3 = added.value;
    const _deleted3 = deleted.value;
    const _changes3 = changes.value;
    const _rowOffset2 = rowOffset.value;
    const _data2 = data.value;
    const _busy2 = busy.value;
    const _cell2 = cell.value;
    if (_cacheId7) {
      if (_pendingCount) {
        rowDrafts.set(_cacheId7, {
          added: _added3,
          deleted: _deleted3
        });
        drafts.set(_cacheId7, _changes3);
        pages.set(_cacheId7, {
          offset: _rowOffset2,
          size: _data2.pageSize ?? 500,
          rows: _data2.rows
        });
      } else {
        drafts.delete(_cacheId7);
        pages.delete(_cacheId7);
        rowDrafts.delete(_cacheId7);
      }
    }
    callback.value?.(_pendingCount > 0 || _busy2 || !!_cell2);
  });
  watchMounted(() => {
    const _pendingCount2 = pendingCount.value;
    return [_pendingCount2];
  }, () => {
    const _pendingCount3 = pendingCount.value;
    if (!_pendingCount3) return;
    const prevent = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', prevent);
    return () => window.removeEventListener('beforeunload', prevent);
  });
  const editable = (column: number, row?: number) => {
    const identity = rowIdentityColumns.value[data.value.columns[column]];
    if (identity && row !== undefined && identity.some(name => data.value.rows[row]?.[data.value.columns.indexOf(name)] == null)) return false;
    const _enabled3 = enabled.value;
    const _blocked = blocked.value;
    const _busy3 = busy.value;
    const _submitted = submitted.value;
    const _deleted4 = deleted.value;
    const _rowOffset3 = rowOffset.value;
    const _added4 = added.value;
    const _insertColumns = insertColumns.value;
    const _data3 = data.value;
    const _allowed = allowed.value;
    return _enabled3 && !_blocked && !_busy3 && !_submitted && (row === undefined || !_deleted4.includes(row + _rowOffset3)) && (row !== undefined && _added4.includes(row) ? _insertColumns.some(c => c.name === _data3.columns[column] && c.editable) : _allowed.includes(_data3.columns[column]));
  };
  const original = (row: number, column: number) => {
    const _data4 = data.value;
    return _data4.rows[row]?.[column] ?? null;
  };
  const placeholder = (row: number, column: number) => {
    const _added5 = added.value;
    const _insertColumns2 = insertColumns.value;
    const _data5 = data.value;
    if (!_added5.includes(row)) return null;
    const meta = _insertColumns2.find(c => c.name === _data5.columns[column]);
    return meta?.generated ? '<generated>' : meta?.defaultExpression != null ? '<default>' : meta?.nullable ? '<null>' : '<required>';
  };
  function payload(pending: Change[]) {
    const _cacheId8 = cacheId.value;
    const _added6 = added.value;
    const _rowOffset4 = rowOffset.value;
    const _deleted5 = deleted.value;
    return {
      cacheId: _cacheId8,
      changes: pending.filter(c => !_added6.includes(c.rowIndex - _rowOffset4)),
      ...(_added6.length ? {
        inserts: _added6.map(row => ({
          values: Object.fromEntries(pending.filter(c => c.rowIndex === row + _rowOffset4).map(c => [c.column, c.value]))
        }))
      } : {}),
      ...(_deleted5.length ? {
        deletes: _deleted5
      } : {})
    };
  }
  function revert() {
    const _cacheId9 = cacheId.value;
    setChanges([]);
    setAdded([]);
    setDeleted([]);
    setCell(null);
    setPreview(null);
    setMessage('Changes reverted.');
    if (_cacheId9) {
      drafts.delete(_cacheId9);
      rowDrafts.delete(_cacheId9);
      pages.delete(_cacheId9);
    }
  }
  function addRow() {
    const _enabled4 = enabled.value;
    const _blocked2 = blocked.value;
    const _busy4 = busy.value;
    const _submitted2 = submitted.value;
    const _insertColumns3 = insertColumns.value;
    const _pendingCount4 = pendingCount.value;
    const _data6 = data.value;
    if (!_enabled4 || _blocked2 || _busy4 || _submitted2 || !_insertColumns3.length) return;
    if (_pendingCount4 >= 100) {
      setMessage('Submit or revert changes first (100 maximum).');
      return;
    }
    const row = Math.max(nextRow.value, _data6.rows.length);
    nextRow.value = row + 1;
    setAdded(current => [...current, row]);
    setPreview(null);
    return row;
  }
  function deleteRows(rows: number[]) {
    const _blocked3 = blocked.value;
    const _busy5 = busy.value;
    const _submitted3 = submitted.value;
    const _insertColumns4 = insertColumns.value;
    const _data7 = data.value;
    const _added7 = added.value;
    const _deleted6 = deleted.value;
    const _rowOffset5 = rowOffset.value;
    const _changes4 = changes.value;
    if (_blocked3 || _busy5 || _submitted3 || !_insertColumns4.length) return;
    const unique = [...new Set(rows)].filter(r => r >= 0 && (r < _data7.rows.length || _added7.includes(r)));
    const next = [...new Set([..._deleted6, ...unique.filter(r => !_added7.includes(r)).map(r => r + _rowOffset5)])];
    if (next.length + _added7.length + _changes4.length > 100) {
      setMessage('Submit or revert changes first (100 maximum).');
      return;
    }
    setAdded(current => current.filter(r => !unique.includes(r)));
    setDeleted(next);
    setChanges(current => current.filter(c => !unique.includes(c.rowIndex - _rowOffset5)));
    setCell(null);
    setPreview(null);
  }
  function changeKey(rowIndex: number, column: string) {
    const identity = rowIdentityColumns.value[column];
    const row = data.value.rows[rowIndex - rowOffset.value];
    if (identity?.length && row) {
      const values = identity.map(name => row[data.value.columns.indexOf(name)]);
      if (values.every(value => value != null)) return JSON.stringify([column, values]);
    }
    return JSON.stringify([rowIndex, column]);
  }
  const changeMap = computed(() => {
    const _changes5 = changes.value;
    return new Map(_changes5.map(c => [changeKey(c.rowIndex, c.column), c]));
  });
  const changeAt = (row: number, column: number) => {
    const _changeMap = changeMap.value;
    const _rowOffset6 = rowOffset.value;
    const _data8 = data.value;
    return _changeMap.get(changeKey(row + _rowOffset6, _data8.columns[column]));
  };
  function open(row: number, column: number, initialText?: string) {
    const _jsonColumns = jsonColumns.value;
    const _data9 = data.value;
    if (!editable(column, row)) return false;
    const value = changeAt(row, column)?.value ?? original(row, column);
    const staged = changeAt(row, column);
    closingInline.value = false;
    setCellError('');
    const current = staged ? staged.value : value;
    const isJson = _jsonColumns.includes(_data9.columns[column]) || current != null && /^[\s]*[\[{]/.test(current) && formatCellJson(current) !== null;
    setCell({
      row,
      column,
      json: isJson,
      replace: initialText !== undefined,
      text: initialText ?? (staged ? staged.value : value) ?? '',
      null: initialText === undefined && (staged ? staged.value : value) === null
    });
    return true;
  }
  function stage(override?: string | null) {
    const _cell3 = cell.value;
    const _changes6 = changes.value;
    const _rowOffset7 = rowOffset.value;
    const _data0 = data.value;
    const _added8 = added.value;
    if (!_cell3 || closingInline.value) return;
    const next = _changes6.filter(c => changeKey(c.rowIndex,c.column) !== changeKey(_cell3.row + _rowOffset7,_data0.columns[_cell3.column]));
    const value = override !== undefined ? override : _cell3.null ? null : _cell3.text;
    if (_cell3.json && value !== null) {
      try {
        JSON.parse(value);
      } catch {
        setCellError('Enter valid JSON or set SQL NULL.');
        return;
      }
    }
    closingInline.value = true;
    const untouchedDefault = _added8.includes(_cell3.row) && !changeAt(_cell3.row, _cell3.column) && override === undefined && _cell3.null && _cell3.text === '';
    if (!untouchedDefault && (_added8.includes(_cell3.row) || value !== original(_cell3.row, _cell3.column))) next.push({
      rowIndex: _cell3.row + _rowOffset7,
      column: _data0.columns[_cell3.column],
      value
    });
    setChanges(next);
    setPreview(null);
    setCell(null);
    setMessage('');
    return next;
  }
  function validateInserts(pending: Change[]) {
    const _added9 = added.value;
    const _insertColumns5 = insertColumns.value;
    const _rowOffset8 = rowOffset.value;
    for (const row of _added9) for (const col of _insertColumns5) {
      const change = pending.find(c => c.rowIndex === row + _rowOffset8 && c.column === col.name);
      if (!col.generated && !col.nullable && (change ? change.value === null : col.defaultExpression == null)) {
        setMessage(`${col.name} requires a value in new row ${row + _rowOffset8 + 1}.`);
        return false;
      }
    }
    return true;
  }
  async function inspect(pending = changes.value) {
    const _added0 = added.value;
    const _deleted7 = deleted.value;
    const _busy6 = busy.value;
    const _submitted4 = submitted.value;
    if (!pending.length && !_added0.length && !_deleted7.length || _busy6 || _submitted4 || inspecting.value) return;
    if (!validateInserts(pending)) return;
    inspecting.value = true;
    setBusy(true);
    setMessage('');
    try {
      setPreview(await invoke<Statement[]>('edit_rows', {
        ...payload(pending),
        apply: false
      }));
    } catch (error) {
      setMessage(String(error));
    } finally {
      inspecting.value = false;
      setBusy(false);
    }
  }
  async function apply(pending = changes.value) {
    const _busy7 = busy.value;
    const _submitted5 = submitted.value;
    const _onLog = onLog.value;
    const _added1 = added.value;
    const _rowOffset9 = rowOffset.value;
    const _deleted8 = deleted.value;
    const _logDatabase = logDatabase.value;
    const _cacheId0 = cacheId.value;
    const _onReload = onReload.value;
    if (_busy7 || _submitted5 || inspecting.value) return;
    if (!validateInserts(pending)) return;
    inspecting.value = true;
    setBusy(true);
    setSubmitted(true);
    setMessage('');
    const started = performance.now();
    _onLog?.({
      text: `Submitting changes (${new Set(pending.filter(c => !_added1.includes(c.rowIndex - _rowOffset9)).map(c => c.rowIndex)).size} updates, ${_added1.length} inserts, ${_deleted8.length} deletes)…`
    });
    try {
      const statements = await invoke<Statement[]>('edit_rows', {
        ...payload(pending),
        apply: true
      });
      const duration = Math.round(performance.now() - started);
      for (const statement of statements) _onLog?.(sqlEvent(_logDatabase ?? '', statement.sql, statement.parameters));
      _onLog?.({
        kind: 'success',
        text: `${statements.length} ${statements.length === 1 ? 'row' : 'rows'} affected in ${duration} ms · Transaction committed`,
        duration
      });
      setChanges([]);
      setAdded([]);
      setDeleted([]);
      rowDrafts.delete(_cacheId0!);
      drafts.delete(_cacheId0!);
      pages.delete(_cacheId0!);
      setPreview(null);
      setMessage('Changes saved. Refreshing results…');
      callback.value?.(false);
      await _onReload?.();
    } catch (error) {
      _onLog?.({
        kind: 'error',
        text: 'Submission failed: ' + String(error),
        duration: Math.round(performance.now() - started)
      });
      setMessage(String(error) + ' Reload results before submitting again.');
      setPreview(null);
    } finally {
      inspecting.value = false;
      setBusy(false);
    }
  }
  const close = () => {
    const _busy8 = busy.value;
    if (!_busy8) {
      setCell(null);
      setPreview(null);
    }
  };
  function paste(cells: {
    row: number;
    column: number;
  }[], value: string, successMessage?: string) {
    const _jsonColumns2 = jsonColumns.value;
    const _data10 = data.value;
    const _changes9 = changes.value;
    const _rowOffset1 = rowOffset.value;
    const _added10 = added.value;
    if (!cells.length) return 'Select a cell first.';
    if (cells.some(c => !editable(c.column, c.row))) return 'The selection contains read-only cells. Nothing was changed.';
    if (cells.length > 100 || value.length > 1_000_000) return 'Paste up to 100 cells, with at most 1 MB per value.';
    for (const c of cells) {
      const old = changeAt(c.row, c.column)?.value ?? original(c.row, c.column);
      const isJson = _jsonColumns2.includes(_data10.columns[c.column]) || old != null && /^\s*[\[{]/.test(old) && formatCellJson(old) !== null;
      if (isJson) {
        try {
          JSON.parse(value);
        } catch {
          return 'A selected cell requires valid JSON. Nothing was changed.';
        }
      }
    }
    const next = [..._changes9];
    for (const c of cells) {
      const at = next.findIndex(change => changeKey(change.rowIndex,change.column) === changeKey(c.row + _rowOffset1,_data10.columns[c.column]));
      if (at >= 0) next.splice(at, 1);
      if (_added10.includes(c.row) || value !== original(c.row, c.column)) next.push({
        rowIndex: c.row + _rowOffset1,
        column: _data10.columns[c.column],
        value
      });
    }
    if (next.length > 100) return 'Apply or revert existing changes first; at most 100 changed cells are supported.';
    setChanges(next);
    setPreview(null);
    setMessage('');
    return successMessage ?? '';
  }
  const isDate = (column: number) => {
    const _dateColumns = dateColumns.value;
    const _data11 = data.value;
    return Object.prototype.hasOwnProperty.call(_dateColumns, _data11.columns[column]);
  };
  function setNow(row: number, column: number) {
    const _dateColumns2 = dateColumns.value;
    const _data12 = data.value;
    if (!isDate(column) || !editable(column, row)) return;
    setMessage(paste([{
      row,
      column
    }], nowForColumn(_dateColumns2[_data12.columns[column]]), 'Current date/time set. Changes are pending Submit.'));
  }
  const isUuid = (column: number) => {
    const _uuidColumns = uuidColumns.value;
    const _data13 = data.value;
    return _uuidColumns.includes(_data13.columns[column]);
  };
  function generateUuid(row: number, column: number) {
    if (!isUuid(column) || !editable(column, row)) return;
    setMessage(paste([{
      row,
      column
    }], crypto.randomUUID(), 'UUID generated. Changes are pending Submit.'));
  }
  function setNull(row: number, column: number) {
    const _changes0 = changes.value;
    const _rowOffset10 = rowOffset.value;
    const _data14 = data.value;
    const _added11 = added.value;
    if (!editable(column, row)) return;
    const next = _changes0.filter(c => changeKey(c.rowIndex,c.column) !== changeKey(row + _rowOffset10,_data14.columns[column]));
    if (_added11.includes(row) || original(row, column) !== null) next.push({
      rowIndex: row + _rowOffset10,
      column: _data14.columns[column],
      value: null
    });
    setChanges(next);
    setPreview(null);
  }
  function requestApply() {
    const _busy0 = busy.value;
    const _submitted7 = submitted.value;
    const _blocked4 = blocked.value;
    const _cell6 = cell.value;
    const _changes1 = changes.value;
    const _added12 = added.value;
    const _deleted9 = deleted.value;
    if (_busy0 || _submitted7 || _blocked4 || inspecting.value || _cell6?.json) return;
    const pending = _cell6 ? stage() : _changes1;
    if (pending && (pending.length || _added12.length || _deleted9.length)) void apply(pending);
  }
  return {
    get isDate() {
      return isDate;
    },
    get setNow() {
      return setNow;
    },
    get isUuid() {
      return isUuid;
    },
    get generateUuid() {
      return generateUuid;
    },
    get added() {
      const _added13 = added.value;
      return _added13;
    },
    get deleted() {
      const _deleted0 = deleted.value;
      return _deleted0;
    },
    get placeholder() {
      return placeholder;
    },
    get addRow() {
      return addRow;
    },
    get deleteRows() {
      return deleteRows;
    },
    get revert() {
      return revert;
    },
    get pendingCount() {
      const _pendingCount5 = pendingCount.value;
      return _pendingCount5;
    },
    get busy() {
      const _busy1 = busy.value;
      return _busy1;
    },
    get submitted() {
      const _submitted8 = submitted.value;
      return _submitted8;
    },
    get canAdd() {
      const _enabled5 = enabled.value;
      const _blocked5 = blocked.value;
      const _busy10 = busy.value;
      const _submitted9 = submitted.value;
      const _insertColumns6 = insertColumns.value;
      return _enabled5 && !_blocked5 && !_busy10 && !_submitted9 && _insertColumns6.length > 0;
    },
    get inspect() {
      const _cell7 = cell.value;
      const _changes10 = changes.value;
      return () => {
        const pending = _cell7 ? stage() : _changes10;
        if (pending) void inspect(pending);
      };
    },
    get requestApply() {
      return requestApply;
    },
    get paste() {
      return paste;
    },
    get setNull() {
      return setNull;
    },
    get hint() {
      const _enabled6 = enabled.value;
      const _allowed2 = allowed.value;
      const _reason = reason.value;
      return _enabled6 ? _allowed2.length ? data.value.joinEditable ? 'Edit source tables directly · Repeated source rows share edits · Primary keys are read-only' : 'Double-click to edit · Primary keys are read-only' : _reason || 'Checking editable columns…' : data.value.editReason ?? undefined;
    },
    get active() {
      const _cell8 = cell.value;
      return (row: number, column: number) => _cell8?.row === row && _cell8.column === column && !_cell8.json;
    },
    get open() {
      return open;
    },
    get editable() {
      return editable;
    },
    get changeAt() {
      return changeAt;
    },
    get changes() {
      const _changes11 = changes.value;
      return _changes11;
    },
    get dirty() {
      const _pendingCount6 = pendingCount.value;
      const _cell9 = cell.value;
      const _busy11 = busy.value;
      return _pendingCount6 > 0 || !!_cell9 || _busy11;
    },
    get message() {
      return message.value;
    },
    get cell() {
      return cell.value;
    },
    get preview() {
      return preview.value;
    },
    get data() {
      return data.value;
    },
    get rowOffset() {
      return rowOffset.value;
    },
    get cellError() {
      return cellError.value;
    },
    get engine() {
      return engine.value;
    },
    get onMove() {
      return onMove.value;
    },
    close,
    stage,
    setCell,
    setCellError,
    apply,
    cancelInline() {
      closingInline.value = true;
      setCell(null);
    }
  };
}
export type GridEditing = ReturnType<typeof useGridEditing>;
