import { StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, gutter, type DecorationSet } from '@codemirror/view';
import { RuntimeWidget, SuccessMarker, type ExecutionMark } from './Editor';

export const setExecutionMarker = StateEffect.define<ExecutionMark | undefined>();
interface MarkerState { lineFrom?: number; decorations: DecorationSet }
const empty: MarkerState = { decorations: Decoration.none };

const executionState = StateField.define<MarkerState>({
  create: () => empty,
  update(value, transaction) {
    // A successful execution describes one exact document. Clear its positions
    // in the editing transaction, before another keystroke or Vue watcher runs.
    if (transaction.docChanged) value = empty;
    for (const effect of transaction.effects) {
      if (!effect.is(setExecutionMarker)) continue;
      const mark = effect.value;
      if (!mark || mark.document !== transaction.newDoc.toString() || !Number.isInteger(mark.from) || mark.from < 0 || mark.from > transaction.newDoc.length) {
        value = empty;
        continue;
      }
      const line = transaction.newDoc.lineAt(mark.from);
      value = {
        lineFrom: line.from,
        decorations: Decoration.set([
          Decoration.widget({widget:new RuntimeWidget(mark.duration),side:1}).range(line.to),
        ]),
      };
    }
    return value;
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

export const executionMarkers = [
  executionState,
  gutter({
    class: 'cm-execution-gutter',
    initialSpacer: () => new SuccessMarker(),
    lineMarker: (view, block) => view.state.field(executionState).lineFrom === block.from ? new SuccessMarker() : null,
    lineMarkerChange: update => update.startState.field(executionState) !== update.state.field(executionState),
  }),
];
