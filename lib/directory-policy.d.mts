export const MAX_FILE: number;
export const MAX_TOTAL: number;
export const MAX_FILES: number;
export function excludedFile(path: string): boolean;
export function inspectBrowserDirectory(files: File[]): { included: { name: string; file: File }[]; excluded: string[]; total: number };
