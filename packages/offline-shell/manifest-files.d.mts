export interface WebGraphEntry {
  file: string;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
  assets?: string[];
  isEntry?: boolean;
}

export function webGraphFiles(graph: Record<string, WebGraphEntry>, entryKey: string): {
  initial: Set<string>;
  offline: Set<string>;
};
