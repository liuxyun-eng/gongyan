// Creates only synthetic research content in the loopback preview.
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { publishMarkdown } from "./publish-markdown.mjs";
const base = "http://127.0.0.1:5173";
const signIn = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = signIn.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("本机模拟登录未开启，请先运行 npm run dev。");
async function api(path, data) {
  const response = await fetch(base + "/api/" + path, {
    method: data ? "POST" : "GET",
    headers: {
      Cookie: cookie,
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error);
  return value;
}
const name = "课题组 · Markdown 示例";
const projects = (await api("projects")).projects;
const project =
  projects.find((project) => project.name === name) ||
  (await api("projects", {
    name,
    description: "模拟科研对话与标定文件，演示只读共享流程。",
  }));
const folder = resolve("work/markdown-demo");
await mkdir(folder, { recursive: true });
await mkdir(".sites-runtime", { recursive: true });
const records = [
  {
    name: "calibration.csv",
    content: "reference,measured\n20.0,20.3\n25.0,25.4\n30.0,30.3\n",
  },
  {
    name: "analysis.py",
    content:
      'import csv\n\nwith open("calibration.csv") as source:\n    rows = list(csv.DictReader(source))\n\nbias = sum(float(row["measured"]) - float(row["reference"]) for row in rows) / len(rows)\nprint(f"Mean bias: {bias:.3f} °C")\n',
  },
];
for (const file of records)
  await writeFile(resolve(folder, file.name), file.content);
const markdown =
  '# 温度传感器标定 · 示例\n\n## User\n我们准备给温度传感器做一次标定。怎样整理数据，让课题组同伴能复核？\n\n## Assistant\n### 先保留原始数据\n\n下面是一组**模拟数据**，用来演示记录方式。每一行都保留参考值和测量值。\n\n| 参考温度 / °C | 测量温度 / °C |\n| --- | --- |\n| 20.0 | 20.3 |\n| 25.0 | 25.4 |\n| 30.0 | 30.3 |\n\n平均偏差可以写为：\n\n$$b = \\frac{1}{N} \\sum_{i=1}^{N}(T_{m,i}-T_{r,i})$$\n\n```python\nerrors = [0.3, 0.4, 0.3]\nbias = sum(errors) / len(errors)\nprint(f"Mean bias: {bias:.3f} °C")\n```\n\n[下载标定数据](<' +
  resolve(folder, "calibration.csv") +
  ">) · [查看分析脚本](<" +
  resolve(folder, "analysis.py") +
  ">)\n\n## User\n同伴阅读这段对话后，怎样接着做？\n\n## Assistant\n先下载数据与脚本，核对测试条件，再使用另一组数据验证。这里保留的是此次讨论的快照。\n\n```mermaid\nflowchart LR\n A[采集数据] --> B[计算偏差]\n B --> C[同伴复核]\n C --> D[独立验证]\n```\n";
await writeFile(resolve(folder, "conversation.md"), markdown);
const room = await api("room?projectId=" + project.id);
let post = room.posts.find((post) => post.title === "温度传感器标定 · 示例");
if (!post) {
  post = await publishMarkdown({ base, headers: { Cookie: cookie }, projectId: project.id, markdown,
    records: records.map(f => ({ ...f, reference: resolve(folder, f.name) })),
  });
}
console.log(
  "Synthetic example: " +
    base +
    "/?project=" +
    project.id +
    "&post=" +
    (post.postId || post.id),
);
console.log("Example Markdown: " + resolve(folder, "conversation.md"));
