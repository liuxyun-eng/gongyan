// Add a synthetic native-export example to the existing local demo workspace.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishMarkdown } from "./publish-markdown.mjs";
const base = "http://127.0.0.1:5173";
const signIn = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
const projects = await (await fetch(base + "/api/projects", { headers: { Cookie: cookie } })).json();
const project = projects.projects.find(p => p.name === "课题组 · Markdown 示例");
assert.ok(project, "Run seed-markdown-demo.mjs first");
const response = await fetch(base + "/api/room?projectId=" + project.id, { headers: { Cookie: cookie } });
assert.equal(response.status, 200);
const room = await response.json();
assert.equal(room.project.name, "课题组 · Markdown 示例");
const title = "标定复核 · Codex 导出示例";
const files = ["calibration.csv", "analysis.py"].map((name) => ({
  name,
  path: resolve("work/markdown-demo", name),
}));
const markdown = `# ${title}

> 请检查温度测量数据，说明误差计算方法。
>
> User context
>
> Files:
> - \`${files[0].path}\`

<details><summary>2 previous messages</summary>

> 我会先读取模拟数据，再核对计算。
>
> <details><summary>Read calibration.csv</summary>
>
> \`\`\`csv
> reference,measured
> 20.0,20.3
> 25.0,25.4
> 30.0,30.3
> \`\`\`
>
> </details>

</details>

### 标定结果

这组模拟数据的平均偏差为 **0.333 °C**。校正时可从测量值减去该偏差。

| 参考温度 / °C | 测量温度 / °C | 偏差 / °C |
| --- | --- | --- |
| 20.0 | 20.3 | +0.3 |
| 25.0 | 25.4 | +0.4 |
| 30.0 | 30.3 | +0.3 |

$$b = \\frac{1}{N}\\sum_{i=1}^{N}(T_{m,i}-T_{r,i})$$

\`\`\`python
errors = [0.3, 0.4, 0.3]
bias = sum(errors) / len(errors)
print(f"Mean bias: {bias:.3f} °C")
\`\`\`

[查看分析脚本](<${files[1].path}>)

> 同伴怎样验证这次结果？

使用一组独立数据复测，并核对传感器型号、环境温度和稳定时间。保留每次测量的原始记录。
`;
await writeFile(resolve("work/markdown-demo/codex-export.md"), markdown);
let postId = room.posts.find((post) => post.title === title)?.id;
if (!postId) {
  const records = [];
  for (const file of files) records.push({ name: file.name, reference: file.path, content: await readFile(file.path) });
  const receipt = await publishMarkdown({ base, headers: { Cookie: cookie }, projectId: project.id, markdown, records });
  postId = receipt.postId;
}
const latest = await (
  await fetch(base + "/api/room?projectId=" + project.id, {
    headers: { Cookie: cookie },
  })
).json();
const messages = JSON.parse(
  latest.posts.find((post) => post.id === postId).transcript,
);
assert.deepEqual(
  messages.map((message) => message.role),
  ["user", "assistant", "user", "assistant"],
);
assert.equal(messages[0].sourceMarkdown, markdown);
assert.equal(messages[0].references.length, 2);
const url = base + "/?project=" + project.id + "&post=" + postId;
await writeFile(
  ".sites-runtime/codex-export-demo.json",
  JSON.stringify({ url, postId }),
);
console.log("Native export demo verified: " + url);
