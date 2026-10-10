import { parseMarkdownConversation } from "./markdown-conversation.mjs";
export function sharedTranscript(post) {
  if (!post) return [];
  try {
    const messages = JSON.parse(post.transcript);
    if (Array.isArray(messages) && messages.length) {
      if (messages[0]?.sourceMarkdown && messages[0]?.snapshotVersion !== 2) {
        try {
          return parseMarkdownConversation(messages[0].sourceMarkdown).messages.map((message, index) => ({
            ...message, id: "restored-" + index,
            ...(index === 0 ? { sourceMarkdown: messages[0].sourceMarkdown, references: messages[0].references } : {}),
          }));
        } catch {}
      }
      return messages;
    }
  } catch {}
  return post.summary ? [{ id: "summary", role: post.kind === "progress" ? "assistant" : "user", content: post.summary }] : [];
}
export function sharedMarkdown(title, messages) {
  return "# " + title + "\n\n" + messages.map(message => "## " + (message.role === "user" ? "User" : "Assistant") + "\n\n" + message.content).join("\n\n");
}
