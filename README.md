# dsh-llm-codex-oauth

在 dsh 里使用你的 **ChatGPT / Codex 订阅**（Plus/Pro/Business/Edu）。插件通过 OpenAI Codex 的 OAuth 流程登录你的 ChatGPT 账号，把订阅额度暴露成 dsh 的 `codex-oauth` 模型提供方。

> ⚠️ **风险提示**：本插件调用 ChatGPT 网页版后端（`chatgpt.com/backend-api`），这是一个未公开、官方不支持的接口，违反 OpenAI 服务条款的风险真实存在，可能导致账号受限。请自行评估后使用。

## 工作原理

- **模型路由**：pi-ai 内置的 `openai-codex` provider（`openai-codex-responses` 线上协议），注册为 dsh LLM seam 的 `codex-oauth` 提供方。模型目录由 pi-ai 随包维护（如 `gpt-5.3-codex-spark`、`gpt-5.4` 等，以实际安装版本为准）。
- **认证**：OAuth 设备码流（`auth.openai.com`，与 Codex CLI 同一 OAuth client）。凭据（refresh/access token）只存在 dsh 凭据库 `$DSH_HOME/.credentials.yaml`（0600），**不进配置、不进会话日志、不进本仓库**；access token 过期时由 pi-ai 在串行化的写路径里自动用 refresh token 续期。
- **登录**：通过对话里的斜杠命令完成（headless 友好，无需本地回调服务器）。

## 安装

```sh
# 需要 pnpm（dsh plugin 转发给它）；没有的话先：npm install -g pnpm
dsh plugin --profile web add file:/Users/pmp/AI/DeepseekHarness
# 重启 dsh web 使新 bundle 生效
```

> **必须用 `file:` 前缀**。直接传目录路径时 pnpm 会以 `link:`（软链到本仓库）安装，
> Node 按真实路径解析插件内部依赖时会找不到 `node_modules` 而加载失败；
> `file:` 会把包复制进 profile 的依赖树（已实测验证）。
> pnpm 11 的 minimum-release-age 门禁会自动放行本插件依赖的 rc 包，无需额外配置。

安装后 `dsh --profile web --dump-config` 应能看到 `llm-codex-oauth` 行。

## 使用

1. 在 dsh 对话里输入 `/codex-login` —— 得到验证网址和设备码。
2. 浏览器打开 `https://auth.openai.com/codex/device`，输入设备码，登录 ChatGPT 账号。
3. `/codex-status` 查看是否已连接（会显示 accountId 与 token 有效期）。
4. 在 Models 设置页把模型切到 `codex-oauth` 提供方下的某个模型。
5. `/codex-logout` 随时登出并删除本地凭据。

## 开发

- 纯 ESM JavaScript，无构建步骤；包根导出命名导出 `apply` / `inject` / `name`。
- `dsh.bundle.patch` 指向 `cordis.patch.yml`，`dsh plugin add` 安装后自动加入 profile 的 bundle 层。
- 本地验证（不需要 pnpm、不需要动运行中的 web profile）：
  ```sh
  # 依赖软链（测试后建议移除）
  ln -sfn ~/.dsh/profiles/node_modules node_modules
  # 单元冒烟：插件加载、模型目录、凭据存储、命令注册
  node .testhome/profiles/codex-test/smoke.mjs
  # 设备码流线上冒烟（签发设备码后自动取消，不涉及任何账号）
  node .testhome/profiles/codex-test/login-smoke.mjs
  # 隔离测试 profile 的组合与真实启动（DSH_HOME 指向工作区内）
  DSH_HOME="$PWD/.testhome" dsh --profile codex-test --dump-config
  DSH_HOME="$PWD/.testhome" dsh --profile codex-test "say ok"
  #   预期最后一步报 CODEX_ERROR: Provider is not configured —— 证明请求已打到本插件路由
  ```
- 官方安装路径的完整演练（用工作区内的本地 pnpm，全程不碰 ~/.dsh）：
  ```sh
  npm install --prefix .tools pnpm --no-save --cache "$PWD/.testhome/npm-cache"
  PATH="$PWD/.tools/node_modules/.bin:$PATH" DSH_HOME="$PWD/.testhome" \
    dsh plugin --profile codex-test2 add file:/Users/pmp/AI/DeepseekHarness
  # codex-test2 的 bundles 已含 dsh-llm-codex-oauth；冒烟脚本见 .testhome/profiles/codex-test2/
  ```
- 已知限制：暂不支持图片输入；动态模型目录跟随所装 pi-ai 版本；登录状态（设备码）仅存于进程内存，重启后以凭据库为准。

## 安全

仓库内不包含任何秘密。如果你把本仓库推到 GitHub（公开或私有），请确认 `.gitignore` 生效，并且**永远不要**提交 `$DSH_HOME/.credentials.yaml` 或其中内容。
