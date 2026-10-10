# 共研 · Markdown 与工作目录共享

面向课题组、电子设计和课程项目。上传 Codex 对话的 Markdown 与本机工作目录，组员在只读页面阅读对话、代码、表格、公式与流程图，并下载成果文件。Markdown 解析和展示不调用模型。

已部署到腾讯云上海：[打开共研](https://gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com/)。登录、成员邀请、共享对话和私有文件存储由云端后端提供，异地成员使用同一网址。免费试用至 2027-04-10；没有购买或升级套餐，自动续费和超额使用关闭。默认域名供测试，正式推广需按腾讯云要求绑定自有域名。

## 使用

1. 在同一浏览器登录共研，创建或加入工作区。
2. 点“分享 Markdown”，自动带上当前工作区。
3. 粘贴或选择 `.md`，点击“选择目录”，在系统窗口选择本机工作目录。
4. 页面读取目录及子目录，列出完整文件清单；确认后点“分享对话与全部文件”。
5. 只有全部文件保存并校验成功才发布对话，成员可阅读并下载。

只支持提供 Markdown 和工作目录，不访问 Codex 对话数据库，也不需要连接文件、JSON 凭证或会话绑定。

本机开发时也可打开 `http://127.0.0.1:6062/`，使用路径形式的本机上传助手。云端网站使用浏览器目录选择器，无需安装这个助手。

## 完整目录上传

目录中的所有普通成果文件都会上传，包括 Markdown 没有链接到的文件、子目录、不同目录中的同名文件和空文件。保留相对路径。`.env`、密钥、系统文件和 `node_modules` 等依赖目录会排除，页面明确列出；不会静默略过无法读取的成果文件。符号链接、读取权限不足、过大文件及超过数量限制会阻止预览，要求调整目录后重试。

当前原型每次最多 500 个文件，单文件 20 MB，目录总量 200 MB；超过限制会明确报错，不显示部分成功。Markdown 最多 400 KB、200 条消息，每条 20,000 字符。

发布前复核完整清单及散列并冻结文件字节。逐文件上传，服务端读取保存后的内容校验 SHA-256。失败自动重试三次，仍失败时保留进程内快照及已确认文件，用户可再次点击重试；不重复发送已确认文件。全部存储回执确认后，在同一个数据库事务中发布对话与文件记录，提交标识防止丢失响应后重试产生重复记录。快照保留最多两小时，重启本机助手后需重新预览。未完成的文件暂存于附件存储，尚未提供自动清理策略。

## 删除对话

每段用户消息和回答都有复制入口，发布者和工作区创建者还能删除单段消息。删除时只移除选中内容，重新生成导出的 Markdown 和摘要，保留其他消息与全部附件。删除全部消息后显示空对话，文件仍可下载。校验版本防止多人同时操作或旧页面误删下一条消息。普通成员可以阅读和复制，不能修改他人的分享。

右击自己上传的对话卡片，选择“删除共享对话”，确认后整条记录从列表移除。其他人的卡片不提供此入口，服务端也只允许发布者删除整条对话。已上传文件解除对话关联，仍保留在工作区“文件”中。删除校验版本，并保留不含对话正文的提交回执标记，阻止旧上传请求重试时重新发布已删除的内容。

## 对话还原

支持 Codex 原生“复制为 Markdown”的引用式用户消息、普通回答、折叠的工具记录、上下文图片与文件路径；同时支持 `## User` / `## Assistant` 等角色标记。用户消息呈现为右侧气泡，工具记录默认折叠。缺少角色结构时明确按一段回答展示。

渲染使用 Streamdown、Shiki、KaTeX、Mermaid、CJK。公式支持 `$...$`、`$$...$$`、`\(...\)` 和 `\[...\]`。后两种只在显示时适配，删除之前保留原始导出内容。Markdown 内的 HTML 与命令不会执行，不下载远程文件或自动加载远程图片。本地链接映射到上传附件，目录之外的引用不会自动读取。

## 启动

使用 Node.js 22.13+：

从 GitHub 首次下载时，先创建本机开发配置；已有 `.openai/hosting.json` 的电脑不要覆盖它。此文件不上传到仓库。腾讯云构建不需要这份配置。

```sh
mkdir -p .openai
cp -n hosting.example.json .openai/hosting.json
```

```sh
npm ci
npm run share
```

工作区 `http://127.0.0.1:5173/`，上传入口 `http://127.0.0.1:6062/`。Ctrl-C 一起停止两个进程。也可单独启动上传助手：

```sh
node integrations/codex/upload-panel.mjs --port 6062 --workspace /完整/成果目录
```

助手只支持 `--port`、`--workspace`、`--site` 三个参数。默认工作区为 `http://127.0.0.1:5173/`；其他本机端口通过 `--site` 指定。网页填写的目录是此次上传范围。独立安装 `gongyan-upload-skill.zip` 时在技能目录执行 `npm install`。

首次空数据库先构建并依次应用迁移；已应用的历史迁移不要修改或重复执行：

```sh
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_shiny_mesmero.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_overjoyed_starfox.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0002_unique_pixie.sql
```

迁移中旧表仅为历史兼容保留，应用不再访问旧的连接及游标表。原有对话和附件保留。

## 验证与示例

```sh
node node_modules/typescript/bin/tsc --noEmit
node --test tests/markdown-import.test.mjs tests/markdown-math.test.mjs tests/shared-transcript.test.mjs
node tests/dev-upload.integration.mjs
node scripts/seed-markdown-demo.mjs
node scripts/seed-codex-export-demo.mjs
```

开发集成测试使用“大文件上传回归 · 合成示例”工作区及临时目录，验证完整目录、子目录同名文件、空文件、传输失败、冻结重试、丢失发布回执、原字节下载、成员权限和逐段删除。示例脚本只创建合成科研资料，位于 `work/markdown-demo/`。

生产 worker 集成测试使用模拟平台身份头，仅可运行于本机隔离测试实例：`GONGYAN_TEST_URL=http://127.0.0.1:8792 node tests/markdown-share.integration.mjs`。验证上传、逐段删除、整条删除的发布者权限、版本冲突、文件保留与旧请求不能重新发布已删除对话。正式身份仍由平台入口验证，上传沿用浏览器登录和工作区成员权限。

## 结构

- `integrations/codex/markdown-panel.html`、`upload-panel.mjs`：本机上传页面、冻结提交和失败重试。
- `integrations/codex/markdown-files.mjs`：完整目录扫描和文件完整性检查。
- `lib/markdown-share.ts`：逐文件持久化校验、完整清单确认与幂等发布。
- `lib/shared-transcript.mjs`：已有导出还原及删除后的 Markdown 生成。
- `components/shared-conversations.tsx`：只读共享页、复制、逐段删除与卡片右键删除。
- `components/markdown-body.tsx`：代码、公式、表格与附件展示。
- `app/api/[...path]/route.ts`：成员权限、删除版本校验和文件下载。
- `db/schema.ts`、`drizzle/`：数据库结构与不可变迁移。

## 当前范围

现在可以通过腾讯云网址跨电脑协作；localhost 地址仍仅用于本机开发。现在不支持后台自动上传、文件协同编辑、模型路由、token 共享或计费。对话列表显示最近 100 条，文件列表显示最近 5,000 个文件；尚无历史分页及文件自动清理。腾讯云部署、上传协议和验收记录见 [tencent/README.md](../tencent/README.md)。
