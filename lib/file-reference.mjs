export function normalizeFilePath(value) {
  try { value = decodeURIComponent(value); } catch { return value; }
  if (/^file:\/\//i.test(value)) {
    try { value = decodeURIComponent(new URL(value).pathname); } catch { return ""; }
  }
  return value
    .replace(/(?:#L?\d+(?:-L?\d+)?|:\d+(?::\d+)?)$/, "")
    .replace(/^(?:\.\/)+/, "");
}

// Only resolve files already attached to this conversation. Older uploads
// stored relative paths; accept an unambiguous path suffix for those records.
// An absolute attachment path must always match exactly.
export function attachmentFor(url, references) {
  const path = normalizeFilePath(url);
  if (!path) return undefined;
  const exact = references.filter((file) =>
    url === "/api/files/" + file.id ||
    (file.path && path === normalizeFilePath(file.path)) ||
    (!path.startsWith("/") && path === normalizeFilePath(file.name)),
  );
  if (exact.length) return uniqueFile(exact);
  if (!path.startsWith("/") || path.startsWith("//")) return undefined;

  const candidates = references.flatMap((file) => {
    const recorded = normalizeFilePath(file.path || "");
    if (recorded.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(recorded)) return [];
    const suffixes = [recorded, normalizeFilePath(file.name)]
      .filter((suffix) => suffix && !suffix.startsWith("/") &&
        !suffix.split("/").some((part) => part === "." || part === "..") &&
        path.endsWith("/" + suffix));
    const score = Math.max(0, ...suffixes.map((suffix) => suffix.length));
    return score ? [{ file, score }] : [];
  });
  const longest = Math.max(0, ...candidates.map((candidate) => candidate.score));
  return uniqueFile(candidates.filter((candidate) => candidate.score === longest).map((candidate) => candidate.file));
}

function uniqueFile(files) {
  const ids = new Set(files.map((file) => file.id));
  return ids.size === 1 ? files[0] : undefined;
}
