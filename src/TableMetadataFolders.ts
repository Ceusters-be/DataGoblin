import { TableObject } from './tableObjects';
export interface TableMetadata {
  objects?: TableObject[];
  loading?: boolean;
  error?: string;
}
