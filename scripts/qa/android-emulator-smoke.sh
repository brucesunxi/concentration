#!/usr/bin/env bash
set -euo pipefail

package_dir="${1:?Package directory is required}"
apk="$package_dir/FocusIslandDev-local.apk"
test -f "$apk"
startup_dir="${UPGRADE_FROM_PACKAGE_DIR:-$package_dir}"
startup_apk="$startup_dir/FocusIslandDev-local.apk"
test -f "$startup_apk"
expected_app_version="$(node -e 'const fs=require("node:fs");const report=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(report.appVersion)' "$startup_dir/apk-smoke-recheck.json")"
test -e /dev/kvm
sudo chmod a+rw /dev/kvm
sdkmanager_path="$(find "$ANDROID_HOME/cmdline-tools" -type f -name sdkmanager | sort -V | tail -n 1)"
test -x "$sdkmanager_path"
export PATH="$(dirname "$sdkmanager_path"):$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
export ANDROID_SDK_HOME="$RUNNER_TEMP"
export ANDROID_USER_HOME="$ANDROID_SDK_HOME/.android"
export ANDROID_EMULATOR_HOME="$ANDROID_USER_HOME"
export ANDROID_AVD_HOME="$ANDROID_USER_HOME/avd"
mkdir -p "$ANDROID_AVD_HOME"

sdkmanager --install 'emulator' 'system-images;android-35;google_apis;x86_64'
echo no | avdmanager create avd -n FocusIslandQA -k 'system-images;android-35;google_apis;x86_64' --device pixel_6 --force
emulator -list-avds | grep -Fx FocusIslandQA
emulator -avd FocusIslandQA -no-window -no-audio -no-boot-anim -no-snapshot -gpu swiftshader_indirect > "$package_dir/emulator.log" 2>&1 &
emulator_pid=$!
api_pid=''
cleanup() {
  if [[ -n "$api_pid" ]]; then kill "$api_pid" 2>/dev/null || true; fi
  kill "$emulator_pid" 2>/dev/null || true
}
trap cleanup EXIT

timeout 240 adb wait-for-device
booted=false
for _ in {1..60}; do
  if [[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  sleep 4
done
test "$booted" = true
adb shell input keyevent 82
# Android reports boot_completed before the launcher has always settled on
# hosted runners. Give the home process time before installing the test APK.
sleep 12
adb install -r "$startup_apk"
adb shell dumpsys package dev.focusisland.family | grep -F "versionName=$expected_app_version"

check_launch() {
  adb shell am start -n dev.focusisland.family/.MainActivity
  local seen=false
  local launcher_waits=0
  local wait_coordinates wait_x wait_y
  for _ in {1..24}; do
    adb shell uiautomator dump /sdcard/focus-window.xml >/dev/null 2>&1 || true
    adb exec-out cat /sdcard/focus-window.xml > "$package_dir/emulator-ui.xml" 2>/dev/null || true
    if grep -Eq 'FOCUS ISLAND|Welcome to Focus Island|欢迎来到专注岛' "$package_dir/emulator-ui.xml"; then seen=true; break; fi
    if grep -Fq "Pixel Launcher isn't responding" "$package_dir/emulator-ui.xml" && (( launcher_waits < 2 )); then
      wait_coordinates="$(python3 - "$package_dir/emulator-ui.xml" <<'PY'
import re
import sys
import xml.etree.ElementTree as ET

for node in ET.parse(sys.argv[1]).getroot().iter('node'):
    if node.get('text') == 'Wait':
        bounds = re.fullmatch(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', node.get('bounds', ''))
        if bounds:
            left, top, right, bottom = map(int, bounds.groups())
            print((left + right) // 2, (top + bottom) // 2)
            break
PY
)"
      if [[ "$wait_coordinates" =~ ^[0-9]+\ [0-9]+$ ]]; then
        read -r wait_x wait_y <<< "$wait_coordinates"
        adb shell input tap "$wait_x" "$wait_y"
        launcher_waits=$((launcher_waits + 1))
        sleep 8
        adb shell am start -n dev.focusisland.family/.MainActivity
      fi
    fi
    sleep 5
  done
  if [[ "$seen" != true ]]; then
    adb exec-out screencap -p > "$package_dir/emulator-failure-screen.png" || true
    echo 'Test app did not reach its welcome screen after launch' >&2
    return 1
  fi
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

if [[ "${RUN_OFFLINE_RECOVERY:-false}" == true && "${RUN_FAMILY_FLOW:-false}" != true ]]; then
  echo 'Offline recovery requires the synthetic family flow' >&2
  exit 1
fi
if [[ "${RUN_BACKGROUND_RESUME:-false}" == true && "${RUN_FAMILY_FLOW:-false}" != true ]]; then
  echo 'Background resume requires the synthetic family flow' >&2
  exit 1
fi
if [[ "${RUN_AUDIO_BACKGROUND:-false}" == true && "${RUN_FAMILY_FLOW:-false}" != true ]]; then
  echo 'Audio background requires the synthetic family flow' >&2
  exit 1
fi
if [[ "${RUN_AUDIO_LOCKSCREEN:-false}" == true && "${RUN_FAMILY_FLOW:-false}" != true ]]; then
  echo 'Audio lockscreen requires the synthetic family flow' >&2
  exit 1
fi
if [[ -n "${UPGRADE_FROM_PACKAGE_DIR:-}" && ( "${RUN_FAMILY_FLOW:-false}" != true || "${RUN_OFFLINE_RECOVERY:-false}" != true ) ]]; then
  echo 'Upgrade requires the synthetic family flow and offline recovery' >&2
  exit 1
fi
if [[ "${SKIP_UPGRADE_AUDIO:-false}" == true && ( -z "${UPGRADE_FROM_PACKAGE_DIR:-}" || "${RUN_AUDIO_BACKGROUND:-false}" == true || "${RUN_AUDIO_LOCKSCREEN:-false}" == true ) ]]; then
  echo 'Skipping narration requires an upgrade and cannot combine with audio interruption checks' >&2
  exit 1
fi
if [[ "${RUN_FAMILY_FLOW:-false}" == true ]]; then
  # Reproduce the physical iQOO's vibrate-mode condition during narration QA.
  adb shell cmd audio set-ringer-mode VIBRATE
  adb shell dumpsys audio | grep -F -- '- mode (internal) = VIBRATE'
  export FOCUS_DATA_DIR="$RUNNER_TEMP/focus-family-qa-data"
  mkdir -p "$FOCUS_DATA_DIR"
  APP_MODE=local node apps/api/main.ts > "$package_dir/family-api.log" 2>&1 &
  api_pid=$!
  ready=false
  for _ in {1..60}; do
    if curl --noproxy '*' -fsS http://127.0.0.1:4181/api/ready > /dev/null 2>&1; then ready=true; break; fi
    sleep 2
  done
  test "$ready" = true
  acceptance_args=(--apk "$apk" --evidence-dir "$package_dir" --reset-synthetic-app --expect-ringer-mode VIBRATE)
  if [[ "${RUN_OFFLINE_RECOVERY:-false}" == true ]]; then acceptance_args+=(--offline-recovery); fi
  if [[ "${RUN_BACKGROUND_RESUME:-false}" == true ]]; then acceptance_args+=(--background-resume); fi
  if [[ "${RUN_AUDIO_BACKGROUND:-false}" == true ]]; then acceptance_args+=(--audio-background); fi
  if [[ "${RUN_AUDIO_LOCKSCREEN:-false}" == true ]]; then acceptance_args+=(--audio-lockscreen); fi
  if [[ -n "${UPGRADE_FROM_PACKAGE_DIR:-}" ]]; then acceptance_args+=(--upgrade-from "$startup_apk"); fi
  if [[ "${SKIP_UPGRADE_AUDIO:-false}" == true ]]; then acceptance_args+=(--skip-audio-check); fi
  python3 scripts/qa/android_practice_life.py "${acceptance_args[@]}" > "$package_dir/family-flow-report.json"
fi

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
  authenticatedFlowVerified: process.env.RUN_FAMILY_FLOW === 'true',
  upgradedFromOlderPackage: !!process.env.UPGRADE_FROM_PACKAGE_DIR,
  notes: process.env.RUN_FAMILY_FLOW === 'true' ? ['Synthetic family and child data were deleted after the test'] : ['No family account or child data was entered', 'Local API is not connected in this smoke test'],
}, null, 2) + '\n');
NODE
