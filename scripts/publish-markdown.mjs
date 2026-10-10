import { randomUUID, createHash } from "node:crypto";
// Synthetic demos and integration checks use the same file-then-commit API.
export async function publishMarkdown({ base, headers, projectId, markdown, records, requestId = randomUUID() }) {
  const files = records.map(file => {
    const bytes = Buffer.from(file.content);
    return { id: file.id || randomUUID(), name: file.name, reference: file.reference || "./" + file.name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
  });
  for (let index = 0; index < files.length; index++) {
    const response = await fetch(base + "/api/markdown-share/files?projectId=" + encodeURIComponent(projectId) + "&requestId=" + requestId + "&file=" + encodeURIComponent(JSON.stringify(files[index])), {
      method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream" }, body: Buffer.from(records[index].content),
    });
    const result = await response.json();
    if (!response.ok || !result.verified) throw new Error(result.error || "File receipt incomplete");
  }
  const response = await fetch(base + "/api/markdown-share?projectId=" + encodeURIComponent(projectId), {
    method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ requestId, markdown, files }),
  });
  const result = await response.json();
  if (!response.ok || !result.verified) throw new Error(result.error || "Publication incomplete");
  return { ...result, manifest: files, requestId };
}
