#!/usr/bin/env bash
# 免 pnpm 一键安装：把插件复制进 profile 的 node_modules 并登记 bundle。
# 用法：bash scripts/install.sh [profile]   （默认 profile 为 web）
set -euo pipefail

PLUGIN="dsh-llm-codex-oauth"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE="${1:-web}"
PROFILE_DIR="$DSH_HOME_DIR/profiles/$PROFILE"
NODE_MODULES="$DSH_HOME_DIR/profiles/node_modules"

if [ ! -d "$PROFILE_DIR" ]; then
  echo "错误：找不到 profile 目录 $PROFILE_DIR" >&2
  echo "请先运行一次 dsh $PROFILE（或 npx @deepseek-ai/dsh $PROFILE）初始化，再执行本脚本。" >&2
  exit 1
fi

if [ ! -f "$REPO/dist/client.js" ]; then
  echo "错误：缺少 dist/client.js，请先在仓库内执行 node build.mjs" >&2
  exit 1
fi

mkdir -p "$NODE_MODULES"
rm -rf "$NODE_MODULES/$PLUGIN"
mkdir -p "$NODE_MODULES/$PLUGIN"
cp -R "$REPO/src" "$REPO/dist" "$REPO/cordis.patch.yml" "$REPO/package.json" "$NODE_MODULES/$PLUGIN/"

node - "$PROFILE_DIR/package.json" "$PLUGIN" <<'NODE'
const fs = require('fs')
const p = process.argv[2]
const name = process.argv[3]
const pkg = JSON.parse(fs.readFileSync(p, 'utf8'))
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!pkg.dsh.profile.bundles.includes(name)) pkg.dsh.profile.bundles.push(name)
fs.writeFileSync(p, JSON.stringify(pkg, null, 2) + '\n')
NODE

echo "已安装 ${PLUGIN} 到 profile「${PROFILE}」（未使用 pnpm）"
echo "重启 dsh 生效：dsh ${PROFILE}（或 npx @deepseek-ai/dsh ${PROFILE}）"
echo
echo "卸载：rm -rf \"${NODE_MODULES}/${PLUGIN}\"，并从 \"${PROFILE_DIR}/package.json\" 的 dsh.profile.bundles 里删掉 \"${PLUGIN}\" 后重启。"
