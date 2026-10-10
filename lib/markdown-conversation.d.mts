export type MarkdownMessage = { role: "user" | "assistant"; content: string };
export function parseMarkdownConversation(raw: string): {
  markdown: string;
  title: string;
  messages: MarkdownMessage[];
  hasRoles: boolean;
  format: "codex" | "roles" | "markdown";
};
export type MarkdownSection =
  | { type: "markdown"; content: string }
  | { type: "fold"; label: string; sections: MarkdownSection[] };
export function markdownSections(content: string): MarkdownSection[];
export function markdownMessageContext(content: string): {
  text: string;
  files: { path: string; name: string; kind: "image" | "file" }[];
  metadata: string;
};
export function markdownFileReferences(
  markdown: string,
): { path: string; label: string }[];
