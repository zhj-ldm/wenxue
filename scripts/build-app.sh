#!/bin/bash
# 打包「问学」为独立 .app（内置 pi Agent，无需任何外部 CLI）
# 用 APFS clonefile 复制 Electron 模板，几乎不额外占用磁盘。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="问学"
BUNDLE_ID="com.wenxue.desktop"
TEMPLATE="$ROOT/node_modules/electron/dist/Electron.app"
OUT_DIR="${OUT_DIR:-/Applications}"   # 默认直接产出到「应用程序」，可用 OUT_DIR=dist ./scripts/build-app.sh 改到项目内
OUT_APP="$OUT_DIR/$APP_NAME.app"

if [ ! -d "$TEMPLATE" ]; then
  echo "❌ 找不到 Electron 模板：$TEMPLATE（请先 npm install）"
  exit 1
fi

echo "→ 复制 Electron 模板（clonefile）"
rm -rf "$OUT_APP"
mkdir -p "$OUT_DIR"
cp -cR "$TEMPLATE" "$OUT_APP" 2>/dev/null || cp -R "$TEMPLATE" "$OUT_APP"

echo "→ 写入应用代码"
RES="$OUT_APP/Contents/Resources"
rm -f "$RES/default_app.asar"
rm -rf "$RES/app"
mkdir -p "$RES/app"
cp -R "$ROOT/electron" "$ROOT/renderer" "$ROOT/prompts" "$RES/app/"
if [ -d "$ROOT/bin" ]; then
  echo "→ 复制内置搜索工具（Aggr Search）"
  mkdir -p "$RES/app/bin"
  # 只带可执行文件，不把 bin/models 等本地模型/缓存打进安装包
  for f in aggrsearch aggrsearch.exe; do
    [ -f "$ROOT/bin/$f" ] && cp "$ROOT/bin/$f" "$RES/app/bin/$f"
  done
fi

echo "→ 复制运行时依赖（pi Agent）"
while IFS= read -r pkg; do
  [ -z "$pkg" ] && continue
  rel="${pkg#$ROOT/}"
  [ "$rel" = "package.json" ] && continue
  mkdir -p "$RES/app/$(dirname "$rel")"
  cp -cR "$pkg" "$RES/app/$rel" 2>/dev/null || cp -R "$pkg" "$RES/app/$rel"
done < <(cd "$ROOT" && npm ls --omit=dev --all --parseable 2>/dev/null | tail -n +2)

# productName 保持 Wenxue，让打包版与开发版共用同一份用户数据（~/Library/Application Support/Wenxue）
VERSION="$(cd "$ROOT" && node -p "require('./package.json').version")"
cat > "$RES/app/package.json" <<JSON
{
  "name": "wenxue",
  "productName": "Wenxue",
  "version": "$VERSION",
  "description": "内置 pi Agent 的 AI 试卷练习桌面应用",
  "main": "electron/main.js",
  "private": true
}
JSON

echo "→ 清理安装包内的用户数据与密钥（防止随包分发）"
find "$RES/app" -path "$RES/app/node_modules" -prune -o -type f \
  \( -name 'settings.json' -o -name 'profiles.json' -o -name 'conversations.json' \
     -o -name '.env' -o -name '.env.*' -o -name '*.key' -o -name '*.pem' \) -print0 \
  | xargs -0 rm -f 2>/dev/null || true
rm -rf "$RES/app/data" "$RES/app/bin/models"

echo "→ 修改 Info.plist"
PB="$OUT_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName $APP_NAME" "$PB"
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $APP_NAME" "$PB"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $BUNDLE_ID" "$PB"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PB"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$PB"

if [ -f "$ROOT/assets/AppIcon.icns" ]; then
  echo "→ 安装图标"
  cp "$ROOT/assets/AppIcon.icns" "$RES/AppIcon.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon.icns" "$PB"
fi

echo "→ ad-hoc 签名"
codesign --force --deep --sign - "$OUT_APP" 2>&1 | grep -v "^replacing" || true
codesign --verify --deep "$OUT_APP" && echo "签名校验通过"

echo ""
echo "✅ 打包完成：$OUT_APP"
du -sh "$OUT_APP"
