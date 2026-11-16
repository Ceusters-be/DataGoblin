import { EditorSelection } from '@codemirror/state';
import { layer, RectangleMarker } from '@codemirror/view';
import { statementRangeAt } from './sql';
import type { Engine } from './types';
interface TextRectangle { left: number; top: number; width: number | null; height: number }
export function statementOutlineBox(rectangles: readonly TextRectangle[]) {
  const rects = rectangles.filter(rect => rect.width != null && rect.width > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map(rect => rect.left));
  const top = Math.min(...rects.map(rect => rect.top));
  const right = Math.max(...rects.map(rect => rect.left + rect.width!));
  const bottom = Math.max(...rects.map(rect => rect.top + rect.height));
  return {left:left-2,top:top-1,width:right-left+4,height:bottom-top+2};
}

export function activeStatementOutline(engine: Engine) {
  return layer({
    above: true,
    class: 'cm-statement-outline-layer',
    update: update => update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged,
    markers(view) {
      const range = statementRangeAt(view.state.doc.toString(), view.state.selection.main.head, engine);
      if (range.from === range.to) return [];
      const rectangles: RectangleMarker[] = [];
      // Multiline selection rectangles reach the viewport edge. Measure each
      // line separately so the outline ends at the actual SQL text instead.
      for (const visible of view.visibleRanges) {
        const start = Math.max(range.from,visible.from), end = Math.min(range.to,visible.to);
        if (start >= end) continue;
        for (let pos=start;pos<end;) {
          const line=view.state.doc.lineAt(pos);
          const to=Math.min(line.to,end);
          if (to>pos) rectangles.push(...RectangleMarker.forRange(view,'',EditorSelection.range(pos,to)));
          pos=line.to+1;
        }
      }
      const box = statementOutlineBox(rectangles);
      return box ? [new RectangleMarker('cm-current-statement-outline',box.left,box.top,box.width,box.height)] : [];
    },
  });
}
