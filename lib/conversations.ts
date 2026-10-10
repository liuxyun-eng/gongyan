export type TranscriptMessage = {
  id: number;
  role: string;
  content: string;
  created_at?: string;
};
export function parseTranscript(
  raw: string,
): { role: string; content: string }[] {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("请输入对话内容。");
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const list = Array.isArray(parsed) ? parsed : parsed.messages;
      if (!Array.isArray(list)) throw new Error();
      const result = list
        .filter((x) => x?.role === "user" || x?.role === "assistant")
        .map((x) => ({
          role: x.role,
          content:
            typeof x.content === "string"
              ? x.content
              : JSON.stringify(x.content),
        }));
      if (!result.length || result.some((x) => !x.content.trim()))
        throw new Error();
      return result;
    } catch {
      throw new Error(
        'JSON 格式需为 [{"role":"user","content":"…"},{"role":"assistant","content":"…"}]。',
      );
    }
  }
  const lines = trimmed.split(/\r?\n/);
  const result: { role: string; content: string }[] = [];
  for (const line of lines) {
    const match = line.match(
      /^\s*(用户|我|User|Human|AI|助手|Assistant|Claude|ChatGPT|Codex)\s*[：:]\s*(.*)$/i,
    );
    if (match) {
      result.push({
        role: /^(用户|我|User|Human)$/i.test(match[1]) ? "user" : "assistant",
        content: match[2],
      });
    } else if (result.length) result[result.length - 1].content += "\n" + line;
    else if (line.trim()) result.push({ role: "user", content: line });
  }
  return result
    .map((x) => ({ ...x, content: x.content.trim() }))
    .filter((x) => x.content);
}
export function excerptSummary(messages: TranscriptMessage[]) {
  const first =
    messages.find((x) => x.role === "user")?.content ||
    messages[0]?.content ||
    "";
  const last =
    messages.filter((x) => x.role === "assistant").at(-1)?.content || "";
  return [
    first && "本次讨论：" + first.slice(0, 180),
    last && "回答摘录：" + last.slice(0, 300),
  ]
    .filter(Boolean)
    .join("\n");
}
