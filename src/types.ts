export interface CodemapRange {
  startLine: number;
  endLine?: number;
}

export interface CodemapMeta {
  title?: string;
  overview?: string;
  createdAt?: string;
}

export interface CodemapNode {
  label: string;
  description?: string;
  filePath?: string;
  range?: CodemapRange;
  children: CodemapNode[];
  number?: string;
  snippet?: string;
}

export interface CodemapFlow {
  id: string;
  prompt: string;
  meta: CodemapMeta;
  roots: CodemapNode[];
}
