export type SharedMessage = {
  id: string | number;
  role: string;
  content: string;
  sourceMarkdown?: string;
  snapshotVersion?: number;
  references?: { id: string; name: string; path: string }[];
};
export function sharedTranscript(post: { transcript: string; summary?: string; kind?: string } | null): SharedMessage[];
export function sharedMarkdown(title: string, messages: SharedMessage[]): string;
