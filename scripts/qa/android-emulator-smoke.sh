#!/usr/bin/env bash
set -euo pipefail

package_dir="${1:?Package directory is required}"
apk="$package_dir/FocusIslandDev-local.apk"
test -f "$apk"
expected_app_version="$(node -e 'const fs=require("node:fs");const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(report.appVersion)' "$package_dir/apk-smoke-recheck.json")"
test -e /dev/kvm
sudo chmod a+rw /dev/kvm

sdkmanager --install 'emulator' 'system-images;android-35;google_apis;x86_64'
echo no | avdmanager create avd -n focus-smoke -k 'system-images;android-35;google_apis;x86_64' --device pixel_6 --force
emulator -avd focus-smoke -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > "$package_dir/emulator.log" 2>&1 &
emulator_pid=$!
trap 'kill "$emulator_pid" 2>/dev/null || true' EXIT

timeout 240 adb wait-for-device
booted=false
for _ in {1..60}; do
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  sleep 4
done
test "$booted" = true
adb shell input keyevent 82
adb install -r "$apk"
adb shell dumpsys package dev.focusisland.family | grep -F "versionName=$expected_app_version"

check_launch() {
  adb shell am start -W -n dev.focusisland.family/.MainActivity
  local seen=false
  for _ in {1..18}; do
    adb shell uiautomator dump /sdcard/focus-window.xml >/dev/null 2>&1 || true
    adb exec-out cat /sdcard/focus-window.xml > "$package_dir/emulator-ui.xml" 2>/dev/null || true
    if grep -Eq 'FOCUS ISLAND|Welcome to Focus Island|欢迎来到专注岛' "$package_dir/emulator-ui.xml"; then seen=true; break; fi
    sleep 5
  done
  test "$seen" = true
  adb shell pidof dev.focusisland.family >/dev/null
  if adb logcat -d -b crash | grep -F 'Process: dev.focusisland.family'; then
    echo 'Focus Island crashed during startup' >&2
    return 1
  fi
}

adb logcat -c
check_launch
adb shell am force-stop dev.focusisland.family
check_launch
adb exec-out screencap -p > "$package_dir/emulator-first-launch.png"

export PACKAGE_DIR="$package_dir"
export EMULATOR_API="$(adb shell getprop ro.build.version.sdk | tr -d '\r')"
export EMULATOR_ABI="$(adb shell getprop ro.product.cpu.abi | tr -d '\r')"
node --input-type=module - <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = process.env.PACKAGE_DIR;
const checked = JSON.parse(await readFile(join(root, 'apk-smoke-recheck.json'), 'utf8'));
await writeFile(join(root, 'emulator-smoke-report.json'), JSON.stringify({
  schemaVersion: 1,
  sourceCommit: checked.sourceSnapshot.sourceCommit,
  appVersion: checked.appVersion,
  apkSha256: checked.apk.sha256,
  emulator: { apiLevel: Number(process.env.EMULATOR_API), abi: process.env.EMULATOR_ABI },
  installed: true,
  loginScreenVisible: true,
  coldRestartPassed: true,
  authenticatedFlowVerified: false,
  notes: ['No family account or child data was entered', 'Local API is not connected in this smoke test'],
}, null, 2) + '\n');
NODE
