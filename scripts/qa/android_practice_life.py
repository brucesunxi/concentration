#!/usr/bin/env python3
"""Run the practice-to-life acceptance flow on an explicitly selected QA device.

The default target is the disposable FocusIslandQA AVD. A physical device requires
an explicit fresh-test-install acknowledgement. Both paths use a local API and
fictional data, delete the test family, and clear only this test app's data.
"""

import argparse
import hashlib
import json
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


PACKAGE = "dev.focusisland.family"
AVD = "FocusIslandQA"
BOUNDS = re.compile(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]")
RABBIT = re.compile(r"^Rabbit \d+$")


class AcceptanceError(RuntimeError):
    pass


class Device:
    def __init__(self, adb: str, serial: str):
        self.adb, self.serial = adb, serial

    def run(self, *args: str, timeout: int = 20) -> str:
        result = subprocess.run(
            [self.adb, "-s", self.serial, *args], capture_output=True,
            text=True, timeout=timeout, check=False,
        )
        if result.returncode:
            raise AcceptanceError(f"adb {' '.join(args[:2])} failed: {result.stderr.strip()[:300]}")
        return result.stdout

    def run_bytes(self, *args: str, timeout: int = 20) -> bytes:
        screenshot = args == ("exec-out", "screencap", "-p")
        if screenshot and not self.app_foreground():
            raise AcceptanceError("Refusing to capture a screenshot outside the test app")
        result = subprocess.run(
            [self.adb, "-s", self.serial, *args], capture_output=True,
            timeout=timeout, check=False,
        )
        if result.returncode:
            raise AcceptanceError(f"adb {' '.join(args[:2])} failed during screenshot capture")
        if screenshot and not self.app_foreground():
            raise AcceptanceError("Test app left foreground during screenshot capture")
        return result.stdout

    def app_foreground(self) -> bool:
        focus = self.run("shell", "dumpsys", "window")
        return bool(re.search(r"mCurrentFocus=.*dev\.focusisland\.family/.+MainActivity", focus))

    def ringer_mode(self) -> str:
        audio = self.run("shell", "dumpsys", "audio")
        mode = re.search(r"- mode \(internal\) = (NORMAL|SILENT|VIBRATE)\b", audio)
        if not mode:
            raise AcceptanceError("Could not identify the device ringer mode")
        return mode.group(1)

    def open_app(self) -> None:
        # Some physical devices return from installation or data reset before
        # the launcher has handed the foreground window back to the app.
        for _ in range(3):
            self.run("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity", timeout=45)
            for _ in range(60):
                if self.app_foreground():
                    return
                time.sleep(0.5)
        raise AcceptanceError("Test app did not remain in the foreground after launch")

    def screen(self) -> list[dict[str, str]]:
        # Android can briefly return an empty hierarchy while an Activity redraws.
        for _ in range(5):
            try:
                if not self.app_foreground():
                    time.sleep(0.4)
                    continue
                self.run("shell", "uiautomator", "dump", "/sdcard/focus-acceptance-window.xml")
                xml = self.run("exec-out", "cat", "/sdcard/focus-acceptance-window.xml")
                nodes = [node.attrib for node in ET.fromstring(xml).iter("node")]
                if self.app_foreground() and any(node.get("package") == PACKAGE for node in nodes):
                    return nodes
            except (AcceptanceError, ET.ParseError):
                time.sleep(0.4)
        raise AcceptanceError("Test app left foreground or its accessibility hierarchy stayed unreadable")

    def swipe(self) -> None:
        self.run("shell", "input", "swipe", "540", "1530", "540", "500", "350")
        time.sleep(0.25)

    def tap_node(self, node: dict[str, str]) -> None:
        match = BOUNDS.fullmatch(node.get("bounds", ""))
        if not match:
            raise AcceptanceError("Accessibility node has no usable bounds")
        x1, y1, x2, y2 = map(int, match.groups())
        if x2 <= x1 or y2 <= y1:
            raise AcceptanceError("Accessibility node has empty bounds")
        self.run("shell", "input", "tap", str((x1 + x2) // 2), str((y1 + y2) // 2))
        time.sleep(0.18)

    def find(self, label: str, *, scroll: bool = False, timeout: float = 12) -> dict[str, str]:
        return self.find_any((label,), scroll=scroll, timeout=timeout)

    def find_any(self, labels: tuple[str, ...], *, scroll: bool = False, timeout: float = 12) -> dict[str, str]:
        deadline = time.monotonic() + timeout
        swipes = 0
        while time.monotonic() < deadline:
            nodes = self.screen()
            found = next((n for n in nodes if n.get("content-desc") in labels and n.get("enabled") != "false"), None)
            if found:
                return found
            if scroll and swipes < 5:
                self.swipe()
                swipes += 1
            else:
                time.sleep(0.3)
        visible_labels = [n.get("content-desc", "") for n in nodes if n.get("content-desc")]
        raise AcceptanceError(f"Could not find any of {labels!r}; visible labels: {visible_labels[:16]}")

    def tap(self, label: str, *, scroll: bool = False, timeout: float = 12) -> None:
        self.tap_node(self.find(label, scroll=scroll, timeout=timeout))

    def wait_text(self, phrase: str, *, timeout: float = 25) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(phrase in n.get("text", "") for n in self.screen()):
                return
            time.sleep(0.3)
        raise AcceptanceError(f"Could not find text {phrase!r}")

    def wait_any_text(self, phrases: tuple[str, ...], *, timeout: float = 25) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(any(phrase in n.get("text", "") for phrase in phrases) for n in self.screen()):
                return
            time.sleep(0.3)
        raise AcceptanceError(f"Could not find any expected text: {phrases!r}")

    def app_audio_uid(self) -> str | None:
        package = self.run("shell", "dumpsys", "package", PACKAGE)
        uid = re.search(r"\buserId=(\d+)\b", package)
        if uid:
            return uid.group(1)
        package_list = self.run("shell", "pm", "list", "packages", "-U", PACKAGE)
        uid = re.search(rf"\bpackage:{re.escape(PACKAGE)}\s+uid:(\d+)\b", package_list)
        return uid.group(1) if uid else None

    def app_audio_started_since(self, before: str, after: str, uid: str) -> bool:
        players = set(re.findall(rf"new player piid:(\d+) uid/pid:{uid}/", after))
        prior = set(before.splitlines())
        return any(
            (match := re.search(r"player piid:(\d+) state:started", line))
            and match.group(1) in players and line not in prior
            for line in after.splitlines()
        )

    def wait_audio_start(self, before: str, *, timeout: float = 7) -> None:
        uid = self.app_audio_uid()
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            # Observe the native player status first: a short clip may finish
            # before dumpsys has returned a system event on a slower phone.
            if any(node.get("content-desc") == "Stop audio" for node in self.screen()):
                return
            if uid and self.app_audio_started_since(before, self.run("shell", "dumpsys", "audio"), uid):
                return
            time.sleep(0.25)
        visible = [node.get("content-desc") or node.get("text") for node in self.screen()]
        raise AcceptanceError(f"No app audio playback event or playing control after tapping narration; visible: {[item for item in visible if item][:18]}")

    def type(self, label: str, value: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise AcceptanceError("Test input must be simple synthetic ASCII")
        self.tap(label, scroll=True)
        self.run("shell", "input", "text", value)
        # Some physical keyboards dismiss themselves after adb text entry.
        # Only send BACK while an input method is actually shown; otherwise
        # BACK can navigate away from the form or leave the app entirely.
        if re.search(r"\bmInputShown=true\b", self.run("shell", "dumpsys", "input_method")):
            self.run("shell", "input", "keyevent", "4")


def api(base: str, path: str, *, method: str = "GET", body=None, token: str | None = None):
    headers = {"X-Focus-Client": "native-local-v1"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(
        base + "/api" + path, method=method, headers=headers,
        data=None if body is None else json.dumps(body).encode(),
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(request, timeout=12) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


def validate_target(device: Device, base: str, apk: Path, physical: bool = False,
                    preinstalled_exact: bool = False) -> None:
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 4181 or parsed.path:
        raise AcceptanceError("Only the local development API at http://127.0.0.1:4181 is allowed")
    if not apk.is_file():
        raise AcceptanceError("Release APK does not exist")
    characteristics = device.run("shell", "getprop", "ro.build.characteristics").strip()
    if physical:
        if device.serial.startswith("emulator-") or "emulator" in characteristics:
            raise AcceptanceError("Physical test mode requires a real Android device")
        if preinstalled_exact:
            paths = device.run("shell", "pm", "path", PACKAGE).strip().splitlines()
            if len(paths) != 1 or not paths[0].startswith("package:/data/app/"):
                raise AcceptanceError("Expected one installed test APK")
            installed = paths[0].removeprefix("package:")
            digest = device.run("shell", "sha256sum", installed).split()[0]
            if digest != hashlib.sha256(apk.read_bytes()).hexdigest():
                raise AcceptanceError("Installed test APK does not match the selected build")
    else:
        if not device.serial.startswith("emulator-"):
            raise AcceptanceError("Only an Android emulator is allowed by default")
        if device.run("emu", "avd", "name").strip().splitlines()[0] != AVD:
            raise AcceptanceError(f"Only the dedicated {AVD} AVD is allowed")
        if characteristics not in {"emulator", "default,emulator"}:
            raise AcceptanceError("Device does not identify as an emulator")
    status, ready = api(base, "/ready")
    if status != 200 or ready.get("status") != "ok" or ready.get("mode") != "local-development":
        raise AcceptanceError("The local development family service is not ready")


def complete_search(device: Device) -> None:
    """Choose every visible rabbit, scanning down the task grid as needed."""
    seen: set[str] = set()
    idle_scrolls = 0
    deadline = time.monotonic() + 28
    while time.monotonic() < deadline:
        nodes = device.screen()
        targets = [n for n in nodes if RABBIT.fullmatch(n.get("content-desc", "")) and n.get("selected") != "true" and n.get("enabled") != "false"]
        if targets:
            node = targets[0]
            seen.add(node["content-desc"])
            device.tap_node(node)
            idle_scrolls = 0
            continue
        if any(n.get("content-desc") == "All found" and n.get("enabled") != "false" for n in nodes) and idle_scrolls >= 1:
            break
        device.swipe()
        idle_scrolls += 1
        if idle_scrolls > 4:
            break
    if not seen:
        visible = [n.get("content-desc") or n.get("text") for n in device.screen()]
        raise AcceptanceError(f"No rabbit target was found; visible: {[value for value in visible if value][:16]}")
    device.tap("All found", scroll=True)
    device.find("Continue", timeout=12)
    if not any(n.get("text") == "This step is complete" for n in device.screen()):
        raise AcceptanceError("Search step did not complete correctly")


def background_and_return(device: Device) -> None:
    device.run("shell", "input", "keyevent", "3")  # HOME
    time.sleep(1)
    device.open_app()


def run_flow(device: Device, base: str, apk: Path, evidence_dir: Path | None,
             offline_recovery: bool = False, background_resume: bool = False,
             upgrade_from: Path | None = None, physical: bool = False,
             preinstalled_exact: bool = False) -> dict:
    suffix = secrets.token_hex(5)
    family, password = f"SyntheticAndroid{suffix}", f"SyntheticAndroidAcceptance{suffix}2026"
    created = False
    token: str | None = None
    result = {"platform": "Android physical" if physical else "Android emulator",
              "deviceModel": device.run("shell", "getprop", "ro.product.model").strip(),
              "androidVersion": device.run("shell", "getprop", "ro.build.version.release").strip(),
              "ringerMode": device.ringer_mode(),
              "avd": None if physical else AVD, "mode": "local-development",
              "apkSha256": hashlib.sha256(apk.read_bytes()).hexdigest(), "formalIndependentSteps": 0,
              "parentReportFormalSteps": None,
              "offlineForcedRestart": False, "pendingBeforeSync": False, "syncedAfterReconnect": False,
              "syncTrigger": None,
              "backgroundInterrupted": False, "backgroundResumed": False,
              "introRetainedAfterBackground": False, "feedbackRetainedAfterBackground": False,
              "backgroundPauseExplained": False,
              "fixedAudioPlaybackStarted": False, "fixedAudioReplayStarted": False,
              "upgradeFromApkSha256": hashlib.sha256(upgrade_from.read_bytes()).hexdigest() if upgrade_from else None,
              "upgradePreservedOfflineJournal": False,
              "nativeSignOutVisible": False, "nativeSignOutHidesFamilyName": False,
              "nativeSignOutSurvivedOfflineRestart": False,
              "backgroundExclusionsInParentReport": 0,
              "selectedTemplate": None, "goalCount": None, "templateCount": None,
              "familyDeleted": False, "appDataCleared": False}
    stage = "install and open"
    try:
        device.run("reverse", "tcp:4181", "tcp:4181")
        install_args = ("install", "--no-streaming", "-r") if physical else ("install", "-r")
        if not preinstalled_exact:
            device.run(*install_args, str(upgrade_from or apk), timeout=90)
        device.run("shell", "pm", "clear", PACKAGE)
        device.open_app()
        stage = "select English"
        device.tap("English", timeout=25)
        stage = "open create-family form"
        device.tap("Create a new test family", scroll=True)
        stage = "fill family name"
        device.type("Family name", family)
        stage = "fill parent password"
        device.type("Parent password", password)
        stage = "confirm fictional details"
        device.tap("I will use fictional details for local testing.", scroll=True)
        created = True
        stage = "create family"
        device.tap("Create family", scroll=True)
        stage = "add test profile"
        device.find("Add a test profile", scroll=True, timeout=25)
        device.tap("Add a test profile", scroll=True)
        device.type("Test nickname", "SyntheticWren")
        device.tap("6-8")
        device.tap("English")
        device.tap("This is a fictional profile for adult development testing.", scroll=True)
        device.tap("Save profile", scroll=True)
        stage = "start practice and read rule"
        device.tap("SyntheticWren · Start today’s suggested practice", scroll=True, timeout=25)
        device.tap("I want to start", scroll=True)
        stage = "verify fixed audio playback"
        listen = device.find_any(("Listen to the rule", "Listen to a tip"), scroll=True, timeout=30)
        audio_before = device.run("shell", "dumpsys", "audio")
        device.tap_node(listen)
        device.wait_audio_start(audio_before)
        if any("Audio could not play" in n.get("text", "") for n in device.screen()):
            raise AcceptanceError("Fixed audio reported a playback error")
        result["fixedAudioPlaybackStarted"] = True
        if evidence_dir:
            (evidence_dir / "android-audio-playing.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
        stage = "verify fixed audio replay"
        # The checked English instruction is about five seconds long. Let it
        # finish so the next tap exercises replay rather than pause.
        time.sleep(6)
        replay = device.find_any(("Listen to the rule", "Listen to a tip"), timeout=18)
        audio_before = device.run("shell", "dumpsys", "audio")
        device.tap_node(replay)
        device.wait_audio_start(audio_before)
        if any("Audio could not play" in n.get("text", "") for n in device.screen()):
            raise AcceptanceError("Fixed audio reported a replay error")
        result["fixedAudioReplayStarted"] = True
        # Leave the short instruction clip time to finish before advancing.
        time.sleep(6)
        if background_resume:
            device.find("I want to try", scroll=True, timeout=30)
            background_and_return(device)
            device.find("I want to try", scroll=True, timeout=30)
            if any(n.get("content-desc") == "I am ready" for n in device.screen()):
                raise AcceptanceError("Backgrounding the rule intro skipped its examples")
            result["introRetainedAfterBackground"] = True
            if evidence_dir:
                (evidence_dir / "android-background-intro.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
        if offline_recovery:
            stage = "recover offline practice"
            device.wait_text("Recovery information for this practice is saved on this device", timeout=30)
            device.run("reverse", "--remove", "tcp:4181")
            device.run("shell", "am", "force-stop", PACKAGE)
            if upgrade_from:
                device.run(*install_args, str(apk), timeout=90)
            device.open_app()
            device.find("Restore this practice", scroll=True, timeout=35)
            visible = device.screen()
            if any(family in str(n) or "SyntheticWren" in str(n) for n in visible):
                raise AcceptanceError("Offline recovery exposed a family identifier")
            if evidence_dir:
                name = "android-upgrade-offline-offer.png" if upgrade_from else "android-offline-offer.png"
                (evidence_dir / name).write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
            device.tap("Restore this practice", scroll=True)
            device.find("I want to try", scroll=True, timeout=30)
            result["offlineForcedRestart"] = True
            result["upgradePreservedOfflineJournal"] = bool(upgrade_from)
        device.tap("I want to try", scroll=True, timeout=25)
        stage = "complete practice"
        for step in range(3):
            if step == 2 and background_resume:
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    if any(RABBIT.fullmatch(n.get("content-desc", "")) for n in device.screen()):
                        break
                    time.sleep(0.3)
                else:
                    raise AcceptanceError("Formal search trial did not become active before backgrounding")
                background_and_return(device)
                device.find("I am ready", timeout=30)
                device.wait_text("does not count as a mistake", timeout=20)
                result["backgroundPauseExplained"] = True
                result["backgroundInterrupted"] = True
                if evidence_dir:
                    (evidence_dir / "android-background-pause.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
                device.tap("I am ready")
                deadline = time.monotonic() + 25
                while time.monotonic() < deadline:
                    if any(RABBIT.fullmatch(n.get("content-desc", "")) for n in device.screen()):
                        result["backgroundResumed"] = True
                        break
                    time.sleep(0.3)
                if not result["backgroundResumed"]:
                    raise AcceptanceError("Formal search trial did not resume after background pause")
            complete_search(device)
            if step < 2:
                if step == 0 and background_resume:
                    background_and_return(device)
                    device.wait_text("This step is complete", timeout=30)
                    device.find("Continue", scroll=True, timeout=20)
                    result["feedbackRetainedAfterBackground"] = True
                    if evidence_dir:
                        (evidence_dir / "android-background-feedback.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
                device.tap("Continue")
                # The wellbeing check can intervene between steps.
                try:
                    device.tap("I feel ready to continue", timeout=2)
                except AcceptanceError:
                    pass
        device.tap("Stop for today")
        if offline_recovery:
            stage = "reconnect and synchronize"
            device.find("Retry sync", scroll=True, timeout=25)
            device.wait_text("Records are saved here and awaiting service confirmation", timeout=20)
            result["pendingBeforeSync"] = True
            if evidence_dir:
                (evidence_dir / "android-pending-sync.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
            device.run("reverse", "tcp:4181", "tcp:4181")
            # Reconnecting can trigger a background sync before the user can tap.
            # Both automatic confirmation and an explicit retry are valid.
            deadline = time.monotonic() + 30
            retry_visible_since: float | None = None
            while time.monotonic() < deadline:
                nodes = device.screen()
                if any("Your records are confirmed by the family service." in n.get("text", "") for n in nodes):
                    result["syncTrigger"] = "automatic"
                    break
                retry = next((n for n in nodes if n.get("content-desc") == "Retry sync" and n.get("enabled") != "false"), None)
                if retry:
                    if retry_visible_since is None:
                        retry_visible_since = time.monotonic()
                    # Leave time for automatic sync. Otherwise its button may
                    # disappear between the hierarchy read and the tap, causing
                    # a tap on the "Back to family space" button below it.
                    if time.monotonic() - retry_visible_since >= 8:
                        device.tap_node(retry)
                        result["syncTrigger"] = "manual-retry"
                        break
                else:
                    retry_visible_since = None
                time.sleep(0.3)
            else:
                raise AcceptanceError("Reconnect exposed neither confirmed records nor a retry action")
            device.wait_text("Your records are confirmed by the family service.", timeout=30)
        else:
            device.find("If you like, explore an everyday goal", scroll=True, timeout=25)
        texts = [n.get("text", "") for n in device.screen()]
        if not any("1 independent step and 0 assisted steps." in value for value in texts):
            raise AcceptanceError("Summary did not show one independent formal step")
        if not any("Your records are confirmed by the family service." in value for value in texts):
            raise AcceptanceError("Summary was not confirmed by the family service")
        if offline_recovery:
            result["syncedAfterReconnect"] = True
        result["formalIndependentSteps"] = 1
        if evidence_dir:
            evidence_dir.mkdir(parents=True, exist_ok=True)
            (evidence_dir / "android-practice-summary.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
        if not offline_recovery:
            device.tap("If you like, explore an everyday goal")
            choice = device.find("Find two little things\nChoose two familiar things and name them with someone at home.", scroll=True, timeout=25)
            if choice.get("checked") != "true":
                raise AcceptanceError("Age-matched everyday activity was not preselected")
            result["selectedTemplate"] = "Find two little things"
            if evidence_dir:
                device.swipe()
                (evidence_dir / "android-life-preselected.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
        status, auth = api(base, "/auth/login", method="POST", body={"name": family, "password": password, "memberLogin": "owner"})
        if status != 200 or not re.fullmatch(r"[a-f0-9]{64}", auth.get("accessToken", "")):
            raise AcceptanceError("Could not read the synthetic family's goal count")
        token = auth["accessToken"]
        status, me = api(base, "/me", token=token)
        if status != 200 or len(me.get("children", [])) != 1:
            raise AcceptanceError("Synthetic family profile was not available")
        status, report = api(base, f"/children/{me['children'][0]['id']}/report", token=token)
        if status != 200 or not isinstance(report.get("sessions"), list):
            raise AcceptanceError("Parent report was not available")
        formal_in_report = sum(
            1 for session in report["sessions"]
            for trial in (session.get("result") or {}).get("trials", [])
            if not trial.get("practice") and not trial.get("assisted")
        )
        if formal_in_report != result["formalIndependentSteps"]:
            raise AcceptanceError("Parent report did not retain the independent practice step")
        result["parentReportFormalSteps"] = formal_in_report
        if background_resume:
            background_exclusions = sum(
                1 for session in report["sessions"]
                for invalidation in (session.get("result") or {}).get("invalidations", [])
                if invalidation.get("reason") == "background" and not invalidation.get("practice")
            )
            if background_exclusions != 1:
                raise AcceptanceError("Parent report did not retain exactly one excluded formal background trial")
            result["backgroundExclusionsInParentReport"] = background_exclusions
        status, space = api(base, f"/children/{me['children'][0]['id']}/life-goals", token=token)
        if status != 200 or space.get("goals") != [] or space.get("total") != 0:
            raise AcceptanceError("Opening the activity created a goal without the child's choice")
        if len(space.get("templates", [])) != 4:
            raise AcceptanceError("Age-matched everyday activity catalogue is incomplete")
        result["goalCount"] = 0
        result["templateCount"] = 4
        if offline_recovery:
            device.tap("Back to family space", scroll=True, timeout=25)
            device.tap("Sign out", scroll=True, timeout=25)
            device.wait_any_text(("Welcome to Focus Island", "欢迎来到专注岛"), timeout=25)
            result["nativeSignOutVisible"] = True
            if any(family in str(node) for node in device.screen()):
                raise AcceptanceError("Signed-out login screen still exposed the family name")
            result["nativeSignOutHidesFamilyName"] = True
            if evidence_dir:
                (evidence_dir / "android-sign-out-login.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
            device.run("reverse", "--remove", "tcp:4181")
            device.run("shell", "am", "force-stop", PACKAGE)
            device.open_app()
            device.wait_any_text(("Welcome to Focus Island", "欢迎来到专注岛"), timeout=30)
            if any(node.get("content-desc") == "Restore this practice" for node in device.screen()):
                raise AcceptanceError("Signed-out offline practice reappeared after restart")
            result["nativeSignOutSurvivedOfflineRestart"] = True
            if evidence_dir:
                (evidence_dir / "android-sign-out-restart.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
        return result
    except Exception as error:
        if evidence_dir and device.app_foreground():
            evidence_dir.mkdir(parents=True, exist_ok=True)
            try:
                (evidence_dir / "android-failure-screen.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
                (evidence_dir / "android-failure-nodes.json").write_text(
                    json.dumps(device.screen(), indent=2), encoding="utf-8"
                )
            except (AcceptanceError, subprocess.TimeoutExpired, OSError):
                pass
        raise AcceptanceError(f"{stage}: {error}") from error
    finally:
        if created:
            try:
                if not token:
                    status, auth = api(base, "/auth/login", method="POST", body={"name": family, "password": password, "memberLogin": "owner"})
                    if status == 200:
                        token = auth.get("accessToken")
                if token:
                    status, _ = api(base, "/family", method="DELETE", body={"currentPassword": password, "familyName": family, "acknowledged": True}, token=token)
                    result["familyDeleted"] = status == 200 and api(base, "/me", token=token)[0] == 401
            except (OSError, urllib.error.URLError):
                pass
        try:
            device.run("shell", "pm", "clear", PACKAGE)
            result["appDataCleared"] = True
        except (AcceptanceError, subprocess.TimeoutExpired):
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, required=True, help="Release APK to install on the dedicated simulator")
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--serial", default="emulator-5554")
    parser.add_argument("--api-base", default="http://127.0.0.1:4181")
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--reset-synthetic-app", action="store_true", help="Required acknowledgement: clears only this test app's data")
    parser.add_argument("--physical-fresh-test-install", action="store_true", help="Use the selected physical device only after confirming this test app was absent before this QA installation")
    parser.add_argument("--preinstalled-exact-apk", action="store_true", help="Use a physical test APK already installed on this device after matching its SHA-256")
    parser.add_argument("--offline-recovery", action="store_true", help="Remove the API port, force-stop, recover offline, then sync")
    parser.add_argument("--background-resume", action="store_true", help="Background an active formal trial, then resume it")
    parser.add_argument("--expect-ringer-mode", choices=("NORMAL", "SILENT", "VIBRATE"), help="Require this device ringer mode before testing narration")
    parser.add_argument("--upgrade-from", type=Path, help="Older APK to install first, then replace offline with --apk")
    args = parser.parse_args()
    if not args.reset_synthetic_app:
        parser.error("--reset-synthetic-app is required because the test app data will be cleared")
    if args.physical_fresh_test_install and args.serial.startswith("emulator-"):
        parser.error("--physical-fresh-test-install requires a physical device serial")
    if args.preinstalled_exact_apk and (not args.physical_fresh_test_install or args.upgrade_from):
        parser.error("--preinstalled-exact-apk requires a physical fresh test install and no upgrade")
    if args.upgrade_from and not args.offline_recovery:
        parser.error("--upgrade-from requires --offline-recovery")
    if args.upgrade_from and not args.upgrade_from.is_file():
        parser.error("--upgrade-from APK does not exist")
    device = Device(args.adb, args.serial)
    try:
        validate_target(device, args.api_base, args.apk, args.physical_fresh_test_install,
                        args.preinstalled_exact_apk)
        if args.expect_ringer_mode and device.ringer_mode() != args.expect_ringer_mode:
            raise AcceptanceError(f"Expected {args.expect_ringer_mode} ringer mode before narration QA")
        result = run_flow(device, args.api_base, args.apk, args.evidence_dir,
                          args.offline_recovery, args.background_resume, args.upgrade_from,
                          args.physical_fresh_test_install, args.preinstalled_exact_apk)
        print(json.dumps(result, indent=2))
        if not result["familyDeleted"] or not result["appDataCleared"]:
            raise AcceptanceError("Synthetic data cleanup did not finish")
        return 0
    except (AcceptanceError, ET.ParseError, subprocess.TimeoutExpired, OSError, urllib.error.URLError) as error:
        print(f"Android acceptance failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
