#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_dir"

notary_profile="crazyparrot-notary"   # 凭据已通过 notarytool store-credentials 存入本机 keychain
team_id="3XBX425673"

npm run build
CSC_NAME="ruaibeite kenny (3XBX425673)" ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ ./node_modules/.bin/electron-builder --mac dir --arm64

app_bundle="dist/mac-arm64/CrazyParrot.app"
# 公证并贴票（notarytool 只接受 zip/pkg/dmg；凭据走 keychain profile，密码不落盘）
if xcrun notarytool history --keychain-profile "$notary_profile" >/dev/null 2>&1; then
  package_zip=$(mktemp -d "${TMPDIR:-/tmp}/crazyparrot-zip.XXXXXX")/CrazyParrot.zip
  ditto -c -k --keepParent "$app_bundle" "$package_zip"
  xcrun notarytool submit "$package_zip" --keychain-profile "$notary_profile" --wait
  xcrun stapler staple "$app_bundle"
  rm -rf "$(dirname "$package_zip")"
  spctl -a -vv "$app_bundle" 2>&1 | grep -q "accepted" || { echo "spctl 验证失败：未通过 Gatekeeper 检查" >&2; exit 1; }
else
  echo "未找到或无法使用 notarytool 凭据 profile，请先运行:" >&2
  echo "  xcrun notarytool store-credentials $notary_profile --apple-id <你的Apple ID> --password <App专用密码> --team-id $team_id" >&2
  exit 1
fi

app_version=$(node -p "require('./package.json').version")
package_stage=$(mktemp -d "${TMPDIR:-/tmp}/crazyparrot-dmg.XXXXXX")
trap 'rm -rf "$package_stage"' EXIT INT TERM

ditto dist/mac-arm64/CrazyParrot.app "$package_stage/CrazyParrot.app"
ln -s /Applications "$package_stage/Applications"
hdiutil create -volname "CrazyParrot $app_version" -srcfolder "$package_stage" -ov -format UDZO "dist/CrazyParrot-$app_version-arm64.dmg"
