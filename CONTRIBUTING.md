# 参与共研

共研目前处于早期预览阶段。欢迎提交问题、改善 Markdown 导入兼容性、优化文件上传体验，或者分享课题组与课程团队的使用反馈。

## 报告问题

请说明浏览器与版本、操作步骤、预期结果和实际结果。涉及 Markdown 或文件上传时，提供脱敏的最小合成示例。不要上传真实聊天记录、未公开研究数据、账号密码或密钥。

功能建议请描述具体场景：谁在使用、目前怎样完成任务、哪个步骤最费时间。首次使用、成员复核和完整文件交付是当前重点。

## 提交代码

1. 先通过 Issue 讨论较大的改动，避免重复工作。
2. 按[开发指南](docs/DEVELOPMENT.md)安装依赖、初始化本机配置与数据库。
3. 保持改动聚焦，解释行为变化及验证方式。
4. 运行相关检查：

```sh
npx tsc --noEmit --incremental false
node --test tests/markdown-import.test.mjs tests/markdown-math.test.mjs tests/shared-transcript.test.mjs
```

涉及云端上传或权限时，使用独立测试环境与合成资料验证。已有数据库迁移不可重写；新增结构变化使用新迁移。不要提交 `.env`、`.openai`、`.sites-runtime`、`work`、`outputs` 或上传附件。

## 项目状态

仓库当前未指定开源许可证。源码可供阅读，但不代表授予再分发或商业使用授权；如有此类需求，请先通过 Issue 联系作者。
