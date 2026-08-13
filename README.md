# dsh-llm-codex-oauth

> 本项目由 DeepSeek-V4-Pro 在 DeepSeek Harness 用时约 3h 不到完成，未进行完整 Code Review，仅人工审查确保基础功能可用，使用前需了解安全风险并自行为此负责。

在 dsh（DeepSeek Harness）里使用你的 **ChatGPT / Codex 订阅**（Plus / Pro / Business / Edu）。插件通过 OpenAI Codex 的 OAuth 流程登录 ChatGPT 账号，把订阅额度暴露成 dsh 的 `codex-oauth` 模型提供方。

> ⚠️ **风险提示**：本插件调用 ChatGPT 网页版后端（`chatgpt.com/backend-api`），这是一个未公开、官方不支持的接口，违反 OpenAI 服务条款的风险真实存在，可能导致账号受限。请自行评估后使用。

## 功能特性

- **订阅模型接入**：把 pi-ai 内置的 `openai-codex` provider（`openai-codex-responses` 线上协议）注册为 dsh LLM seam 的 `codex-oauth` 提供方；模型目录随所装 pi-ai 维护（如 `gpt-5.3-codex-spark`、`gpt-5.4`、`gpt-5.5`、`gpt-5.6-*` 等）。
- **OAuth 设备码登录**：走 `auth.openai.com`（与 Codex CLI 同一 OAuth client），headless 友好，无需本地回调服务器。
- **凭据安全**：refresh / access token 只存在 dsh 凭据库 `$DSH_HOME/.credentials.yaml`（0600），**不进配置、不进会话日志、不进本仓库**；access token 过期时由 pi-ai 在串行化的写路径里自动用 refresh token 续期。
- **设置页登录**：在设置页提供「Codex 订阅 (ChatGPT)」区块，含登录 / 登出按钮与实时状态；对话侧仅保留只读的 `/codex-status`、`/codex-logout` 命令。
- **多轮对话**：完整保留 provider 原生回放元数据（签名等），支持跨轮次多轮请求。

## 安装

```sh
# 需要 pnpm（dsh plugin 转发给它）；没有的话先：npm install -g pnpm
dsh plugin --profile web add file:/path/to/dsh-llm-codex-oauth
# 重启 dsh web 使新 bundle 生效
```

> **必须用 `file:` 前缀**。直接传目录路径时 pnpm 会以 `link:`（软链到本仓库）安装，
> Node 按真实路径解析插件内部依赖时会找不到 `node_modules` 而加载失败；
> `file:` 会把包复制进 profile 的依赖树（已实测验证）。
> pnpm 11 的 minimum-release-age 门禁会自动放行本插件依赖的 rc 包，无需额外配置。
>
> **pnpm 11 的 ignored-builds 提示会让 `dsh plugin` 报 "pnpm failed"**（依赖其实已装好）。
> 修复：把 profile 目录 `pnpm-workspace.yaml` 里 pnpm 生成的 `allowBuilds:` 占位值改为 `false`
> （`@google/genai`、`protobufjs` 的构建脚本对本插件无关紧要），然后重跑同一命令完成 bundle 对账。

安装后 `dsh --profile web --dump-config` 应能看到 `llm-codex-oauth` 行。

> **更新插件代码**：`file:` 安装是硬链接快照，编辑器替换式写入不会被 pnpm 感知，直接重跑
> `add` 不会刷新。请先 bump `package.json` 的 version，再完整重装并重启 dsh：
> ```sh
> dsh plugin --profile web remove dsh-llm-codex-oauth
> dsh plugin --profile web add file:/path/to/dsh-llm-codex-oauth
> ```

## 使用

1. 重启 dsh 后打开**设置页**，侧栏选择「Codex 订阅 (ChatGPT)」。
2. 点击「登录 ChatGPT 账号」，按提示打开验证网址、输入设备码并登录你的 ChatGPT 账号。
3. 状态变为「已连接」后，在 **Models 设置页**把模型切到 `codex-oauth` 提供方下的某个模型。
4. 登出：回设置页点「登出」，或在对话里输入 `/codex-logout`；`/codex-status` 可随时查看状态。

## 工作原理

| 组件 | 说明 |
|---|---|
| `src/adapter.js` | `LlmAdapter` 实现：codex 流 → dsh `StreamChunk` 协议、签名回放、错误分类、空闲看门狗 |
| `src/store.js` | pi-ai `CredentialStore` ↔ dsh 凭据库的桥（串行化读写，token 不出宿主） |
| `src/login.js` | 设备码登录编排（pi-ai 官方流，自动持久化凭据） |
| `src/server.js` | 宿主 `webServer` 挂 `/codex-oauth` HTTP 路由（status / login / logout），供浏览器半调用 |
| `src/client.js` | 浏览器半：设置页 `settings.section` 区块，经 `build.mjs` 打包成 client-modules 工厂格式 |
| `src/commands.js` | 只读命令 `/codex-status`、`/codex-logout` |

## 开发

- 纯 ESM JavaScript；宿主半无构建步骤（命名导出 `apply` / `inject` / `name`）。
- 浏览器半用 esbuild 打包：`node build.mjs`（React 外部化为 `require("react")`，复用宿主实例）。
- `dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh plugin add` 安装后自动加入 profile 的 bundle 层。
- 测试套件在 `test/`：`smoke.mjs`（provider 路由 / HTTP 端点 / 命令 / 凭据库）、`stream-test.mjs`（流翻译、回放、错误分类、选项装配，含多轮回放回归用例）、`login-smoke.mjs`（设备码流联网冒烟，不涉及账号）。它们通过 profile 依赖树解析依赖，放进已安装本插件的 profile 目录运行：
  ```sh
  cp test/*.mjs .testhome/profiles/codex-test2/ && cd .testhome/profiles/codex-test2
  node smoke.mjs && node stream-test.mjs && node login-smoke.mjs
  ```
- 已知限制：暂不支持图片输入；模型目录跟随所装 pi-ai 版本；登录状态（设备码）仅存于进程内存，重启后以凭据库为准。

## 安全与合规

- 仓库内不包含任何秘密。推送到 GitHub（公开或私有）前请确认 `.gitignore` 生效，**永远不要**提交 `$DSH_HOME/.credentials.yaml` 或其中内容。
- 本插件使用未公开的 ChatGPT 后端接口，存在违反 OpenAI 条款、账号受限的风险，使用者自担风险。

## License

MIT
