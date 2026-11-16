export type Props = {
  dirty: boolean;
  count: number;
  busy: boolean;
  submitted: boolean;
  canAdd: boolean;
  canDelete: boolean;
  onRefresh?: () => Promise<void>;
  onCancel?: () => void;
  cancellable?: boolean;
  interval?: number;
  onInterval?: (seconds: number) => void;
  onAdd: () => void;
  onDelete: () => void;
  onRevert: () => void;
  onPreview: () => void;
  onSubmit: () => void;
  onExport: () => void;
};
