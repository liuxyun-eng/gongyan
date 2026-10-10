# 共研腾讯云部署

网址：https://gongyan-d6gqg5jl234d901e6-1503317224.ap-shanghai.app.tcloudbase.com/

环境 `gongyan-d6gqg5jl234d901e6`，上海，HTTP 云函数 `gongyan-backend`。前端与 API 同源，数据库是 PostgreSQL 私有 `gongyan` schema，文件位于私有 `gongyan-files` 桶。静态托管旧网址跳转到完整应用。原有本机真实对话、文件和账号没有上传到云端；云端验收使用独立的合成测试资料。

免费试用到 2027-04-10 23:59:59（北京时间）。当前套餐限制云函数 256 MB、3 秒；没有升级、购买、开启自动续费或超额使用。默认域名仅供测试，腾讯云访问提示由平台显示；正式推广需绑定自己的域名。

## 使用

首次注册自己的账号，创建工作区，通过“邀请”把邀请码给伙伴。伙伴注册后使用“通过邀请码加入”。分享时粘贴 Markdown 与目录路径，核对清单并发布。路径读取需要在自己的电脑运行 `npm run directory`；无需 Finder 或连接配置，详见[开发指南](../docs/DEVELOPMENT.md#使用)。云端账户与本机开发身份分别存储。

每次最多 500 个文件，单文件 20 MB，总量 200 MB；保留子目录和空文件，敏感凭证、依赖及系统文件按清单排除。浏览器分成 2 MB 的同源请求，服务端保存为不可覆盖的临时分段，流式合并到私有文件，再独立读回核对整体 SHA-256 和大小。所有文件均有校验回执后，一次事务发布对话与全部文件记录。失败保留当前页面快照并支持重试；关闭页面后需重新预览目录。下载先检查工作区成员身份，再发放 60 秒有效的私有下载链接。

临时分段目前没有自动清理任务，失败上传会占用存储；需要在扩大量级前增加过期分段清理。删除整条对话会保留工作区文件，单段删除重建可导出的 Markdown；旧请求不能复活已删除的对话。

## 更新部署

下列命令用于更新作者已经初始化的腾讯云环境，不是面向新账号的一键开通工具。迁移到自己的账户时，需要先建立对应的数据库、私有文件存储与 HTTP 服务，并调整 `manage.mjs` 的环境 ID、`deploy.mjs` 的域名，以及 `scripts/build-tencent-static.mjs` 中的旧域名跳转。不要把作者的资源标识当成自己的配置。首次部署前还需检查套餐额度与平台域名要求。

使用官方 CloudBase CLI 的已有授权。管理脚本仅在内存读取官方 CLI 凭证，不将服务密钥写入前端、源码或验证报告；后端密钥和密码 pepper 继续沿用云函数现有环境变量。

```sh
npm ci
# 首次在新电脑部署时，先在浏览器完成官方 CLI 授权。
npx @cloudbase/cli@3.8.5 login
npm run build:tencent
node scripts/build-tencent-server.mjs
CLOUDBASE_CIID=gongyan-deployment TCB_DISABLE_REPORT=1 node tencent/deploy.mjs
```

首次初始化 PostgreSQL 使用 `schema.sql`，不要删除现有 `.openai/hosting.json` 中原平台的资源标识。此腾讯云部署不修改原平台资源。

## 验收

以下报告由本机验收脚本生成，包含临时测试对象标识，因此不随 GitHub 源码发布。可在独立测试环境运行仓库中的脚本生成自己的结果。

- `outputs/tencent-cloud-verification.json`：注册、登录、双账号邀请与共享、中文路径、空文件和 20 MB 文件、字节下载校验、成员权限与单段删除。
- `outputs/tencent-directory-verification.json`：500 个文件全部实际上传、发布、下载并核对散列。
- `outputs/tencent-browser-upload-verification.json`：Safari 中选择真实测试目录并发布后，3 个文件下载内容与原文件逐一一致。
- `outputs/tencent-cloud-browser-upload.png`：浏览器分享成功页面。
- `outputs/tencent-private-access-verification.json`：未授权数据库调用、私有文件读取和公开桶读取被拒绝。
- `outputs/tencent-deletion-and-corruption-verification.json`：作者整条删除、重复删除、旧请求不复活，错误内容不能发布。
- `outputs/local-upload-cleanup.json`：按用户要求清除本机历史上传，保留源目录、账号与工作区。
- `outputs/tencent-test-cleanup.json`：清除报告中精确标识的合成测试账号及其云端资料，保留其他用户。

云端验证会创建使用公开测试密码的临时账号。验证结束后运行 `node tencent/cleanup-test-data.mjs` 查看清理范围，再用 `--apply` 删除这些测试账号和数据；不能将它们留作真实使用账号。
