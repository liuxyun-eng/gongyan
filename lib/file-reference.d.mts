export function normalizeFilePath(value: string): string;
export function attachmentFor<T extends { id: string; name: string; path: string }>(url: string, references: T[]): T | undefined;
