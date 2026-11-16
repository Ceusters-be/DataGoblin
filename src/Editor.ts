import { Engine } from './types';
import { Table } from './types';
import { Column } from './types';
import { type SqlTarget } from './editorNavigation';
import { GutterMarker, WidgetType } from '@codemirror/view';
export interface EditorHandle {
  format: () => void;
}
export interface ExecutionMark {
  document: string;
  from: number;
  duration: number;
}
export class SuccessMarker extends GutterMarker {
  toDOM() {
    const node = document.createElement('span');
    node.className = 'cm-execution-check';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M3 8l3 3 7-7');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.8');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    node.append(svg);
    node.title = 'Query executed successfully';
    node.setAttribute('aria-label', node.title);
    return node;
  }
}
export class RuntimeWidget extends WidgetType {
  constructor(readonly duration: number) {
    super();
  }
  eq(other: RuntimeWidget) {
    return other.duration === this.duration;
  }
  toDOM() {
    const node = document.createElement('span');
    node.className = 'cm-execution-time';
    node.textContent = this.duration < 1000 ? `${Math.round(this.duration)} ms` : `${(this.duration / 1000).toFixed(2)} s`;
    node.title = 'Time to return this query result';
    return node;
  }
}
export interface Props {
  completionCatalog?: import('./completionMetadata').CompletionCatalog;
  onFormatError?: (message: string) => void;
  tables?: Table[];
  columns?: Record<string, Column[]>;
  onReveal?: (table: Table) => void;
  onOpenData?: (table: Table) => void;
  onMetadata?: (target: SqlTarget) => Promise<string>;
  execution?: ExecutionMark;
  value: string;
  engine: Engine;
  schema: Record<string, string[]>;
  onChange: (value: string) => void;
  onRun: (sql: string, from?: number) => void;
  onSave: () => void;
}
