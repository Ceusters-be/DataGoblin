import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
export const codeHighlighting = syntaxHighlighting(HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: [tags.name, tags.special(tags.string)], color: 'var(--syntax-property)' },
  { tag: [tags.standard(tags.name), tags.function(tags.variableName)], color: 'var(--syntax-function)' },
  { tag: tags.special(tags.name), color: 'var(--syntax-parameter)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [tags.propertyName, tags.typeName], color: 'var(--syntax-property)' },
  { tag: [tags.operator, tags.punctuation], color: 'var(--fg-secondary)' },
]));
export const codeSurface = EditorView.theme({
  // CodeMirror panels use a high z-index internally. Keep those layers local
  // so Vim status/search bars cannot paint over application dialogs.
  '&': { backgroundColor: 'var(--bg)', color: 'var(--fg)', isolation: 'isolate' },
  '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--muted)', border: 'none' },
  // The selection layer sits behind the content: keep the active line translucent.
  '.cm-activeLine': { backgroundColor: 'var(--editor-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--hover)', color: 'var(--fg)' },
  '.cm-current-statement-outline': {
    border: '1px solid color-mix(in srgb, var(--accent) 55%, transparent)',
    boxSizing: 'border-box', pointerEvents: 'none',
  },
  '.cm-cursor': { borderLeftColor: 'var(--fg)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'var(--editor-selection-inactive)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--editor-selection)' },
  '.cm-content ::selection, .cm-content::selection': { backgroundColor: 'var(--editor-selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--border)', borderRadius: '2px' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--accent)', color: 'var(--fg)' },
  '.cm-tooltip, .cm-panels': { backgroundColor: 'var(--raised)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-tooltip-autocomplete': { border: '1px solid var(--border)', borderRadius: '7px', boxShadow: 'var(--shadow)', overflow: 'hidden' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'inherit', fontSize: '12px', padding: '4px', maxHeight: '280px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '5px 8px', borderRadius: '4px', lineHeight: '1.6' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected="true"]': { backgroundColor: 'var(--completion-selected)', color: 'var(--completion-fg)' },
  '.cm-completionMatchedText': { color: 'var(--accent)', fontWeight: '700', textDecoration: 'none' },
  '.cm-tooltip-autocomplete li[aria-selected="true"] .cm-completionMatchedText': { color: 'inherit', textDecoration: 'underline', textUnderlineOffset: '3px' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'normal', marginLeft: '16px' },
  '.cm-tooltip-autocomplete li[aria-selected="true"] .cm-completionDetail': { color: 'inherit', opacity: '0.85' },
  '.cm-completionIcon': { opacity: '0.8', paddingRight: '8px' },
  '.cm-searchMatch': { backgroundColor: 'var(--search-match)' },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--search-active)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--hover)', color: 'var(--fg-secondary)', borderColor: 'var(--border)' },
});

export function editorAppearance(dark: boolean) {
  return [codeSurface, codeHighlighting, EditorView.theme({
    '&': { height: '100%', fontSize: '13px' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono)', lineHeight: '1.7' },
    '.cm-content': { padding: '12px 0' },
    '.cm-gutters': { paddingRight: '6px' },
    '.cm-lineNumbers': { order: '0' },
    '.cm-lineNumbers .cm-gutterElement': { minWidth: '32px', padding: '0 7px 0 8px' },
    '.cm-execution-gutter': { order: '1', width: '22px' },
    // CodeMirror uses a zero-height hidden spacer in each gutter. Fixed-size
    // icons must not give that flex item an automatic minimum height.
    '.cm-execution-gutter .cm-gutterElement, .cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '0', flexShrink: '0', padding: '0', overflow: 'hidden' },
    '.cm-execution-gutter .cm-gutterElement': { width: '22px' },
    '.cm-foldGutter': { order: '2', width: '20px' },
    '.cm-foldGutter .cm-gutterElement': { width: '20px' },
    '.cm-foldGutter .cm-gutterElement span': { display: 'block', flexShrink: '0', padding: '0', width: '14px', height: '14px', fontSize: '0', backgroundColor: 'currentColor', maskImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m4 6 4 4 4-4' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")` },
    '.cm-foldGutter span[title="Unfold line"]': { transform: 'rotate(-90deg)' },
    '.cm-execution-check svg': { display: 'block' },
    '.cm-execution-check': { color: 'var(--syntax-string)', fontWeight: '700', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width: '14px', height: '14px', flexShrink: '0' },
    '.cm-execution-time': { color: 'var(--muted)', fontFamily: 'var(--font-ui)', fontSize: '11px', paddingLeft: '14px', paddingRight: '6px', userSelect: 'none' },
  }, { dark })];
}
