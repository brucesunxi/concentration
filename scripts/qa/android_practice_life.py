#!/usr/bin/env python3
"""Run the practice-to-life acceptance flow on the disposable FocusIslandQA AVD.

This script intentionally refuses physical devices, other AVDs, and non-local APIs.
It creates fictional data, checks that browsing an activity does not save a goal,
then deletes the family and clears the dedicated simulator app data.
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
        result = subprocess.run(
            [self.adb, "-s", self.serial, *args], capture_output=True,
            timeout=timeout, check=False,
        )
        if result.returncode:
            raise AcceptanceError(f"adb {' '.join(args[:2])} failed during screenshot capture")
        return result.stdout

    def screen(self) -> list[dict[str, str]]:
        self.run("shell", "uiautomator", "dump", "/sdcard/focus-acceptance-window.xml")
        xml = self.run("exec-out", "cat", "/sdcard/focus-acceptance-window.xml")
        return [node.attrib for node in ET.fromstring(xml).iter("node")]

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
        deadline = time.monotonic() + timeout
        swipes = 0
        while time.monotonic() < deadline:
            nodes = self.screen()
            found = next((n for n in nodes if n.get("content-desc") == label and n.get("enabled") != "false"), None)
            if found:
                return found
            if scroll and swipes < 5:
                self.swipe()
                swipes += 1
            else:
                time.sleep(0.3)
        labels = [n.get("content-desc", "") for n in nodes if n.get("content-desc")]
        raise AcceptanceError(f"Could not find {label!r}; visible labels: {labels[:16]}")

    def tap(self, label: str, *, scroll: bool = False, timeout: float = 12) -> None:
        self.tap_node(self.find(label, scroll=scroll, timeout=timeout))

    def wait_text(self, phrase: str, *, timeout: float = 25) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if any(phrase in n.get("text", "") for n in self.screen()):
                return
            time.sleep(0.3)
        raise AcceptanceError(f"Could not find text {phrase!r}")

    def type(self, label: str, value: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9_-]+", value):
            raise AcceptanceError("Test input must be simple synthetic ASCII")
        self.tap(label, scroll=True)
        self.run("shell", "input", "text", value)
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


def validate_target(device: Device, base: str, apk: Path) -> None:
    parsed = urllib.parse.urlsplit(base)
    if parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.port != 4181 or parsed.path:
        raise AcceptanceError("Only the local development API at http://127.0.0.1:4181 is allowed")
    if not apk.is_file():
        raise AcceptanceError("Release APK does not exist")
    if not device.serial.startswith("emulator-"):
        raise AcceptanceError("Only an Android emulator is allowed")
    if device.run("emu", "avd", "name").strip().splitlines()[0] != AVD:
        raise AcceptanceError(f"Only the dedicated {AVD} AVD is allowed")
    if device.run("shell", "getprop", "ro.build.characteristics").strip() not in {"emulator", "default,emulator"}:
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
        raise AcceptanceError("No rabbit target was found")
    device.tap("All found", scroll=True)
    device.find("Continue", timeout=12)
    if not any(n.get("text") == "This step is complete" for n in device.screen()):
        raise AcceptanceError("Search step did not complete correctly")


def run_flow(device: Device, base: str, apk: Path, evidence_dir: Path | None, offline_recovery: bool = False) -> dict:
    suffix = secrets.token_hex(5)
    family, password = f"SyntheticAndroid{suffix}", f"SyntheticAndroidAcceptance{suffix}2026"
    created = False
    token: str | None = None
    result = {"platform": "Android emulator", "avd": AVD, "mode": "local-development",
              "apkSha256": hashlib.sha256(apk.read_bytes()).hexdigest(), "formalIndependentSteps": 0,
              "parentReportFormalSteps": None,
              "offlineForcedRestart": False, "pendingBeforeSync": False, "syncedAfterReconnect": False,
              "selectedTemplate": None, "goalCount": None, "templateCount": None,
              "familyDeleted": False, "appDataCleared": False}
    try:
        device.run("reverse", "tcp:4181", "tcp:4181")
        device.run("install", "-r", str(apk), timeout=90)
        device.run("shell", "pm", "clear", PACKAGE)
        device.run("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
        device.tap("English", timeout=25)
        device.tap("Create a new test family", scroll=True)
        device.type("Family name", family)
        device.type("Parent password", password)
        device.tap("I will use fictional details for local testing.", scroll=True)
        created = True
        device.tap("Create family", scroll=True)
        device.find("Add a test profile", scroll=True, timeout=25)
        device.tap("Add a test profile", scroll=True)
        device.type("Test nickname", "SyntheticWren")
        device.tap("6-8")
        device.tap("English")
        device.tap("This is a fictional profile for adult development testing.", scroll=True)
        device.tap("Save profile", scroll=True)
        device.tap("SyntheticWren · Start today’s suggested practice", scroll=True, timeout=25)
        device.tap("I want to start", scroll=True)
        if offline_recovery:
            device.wait_text("Recovery information for this practice is saved on this device", timeout=30)
            device.run("reverse", "--remove", "tcp:4181")
            device.run("shell", "am", "force-stop", PACKAGE)
            device.run("shell", "am", "start", "-n", f"{PACKAGE}/.MainActivity")
            device.find("Restore this practice", scroll=True, timeout=35)
            visible = device.screen()
            if any(family in str(n) or "SyntheticWren" in str(n) for n in visible):
                raise AcceptanceError("Offline recovery exposed a family identifier")
            if evidence_dir:
                (evidence_dir / "android-offline-offer.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
            device.tap("Restore this practice", scroll=True)
            device.find("I want to try", scroll=True, timeout=30)
            result["offlineForcedRestart"] = True
        device.tap("I want to try", scroll=True, timeout=25)
        for step in range(3):
            complete_search(device)
            if step < 2:
                device.tap("Continue")
                # The wellbeing check can intervene between steps.
                try:
                    device.tap("I feel ready to continue", timeout=2)
                except AcceptanceError:
                    pass
        device.tap("Stop for today")
        if offline_recovery:
            device.find("Retry sync", scroll=True, timeout=25)
            device.wait_text("Records are saved here and awaiting service confirmation", timeout=20)
            result["pendingBeforeSync"] = True
            if evidence_dir:
                (evidence_dir / "android-pending-sync.png").write_bytes(device.run_bytes("exec-out", "screencap", "-p"))
            device.run("reverse", "tcp:4181", "tcp:4181")
            device.tap("Retry sync")
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
        status, space = api(base, f"/children/{me['children'][0]['id']}/life-goals", token=token)
        if status != 200 or space.get("goals") != [] or space.get("total") != 0:
            raise AcceptanceError("Opening the activity created a goal without the child's choice")
        if len(space.get("templates", [])) != 4:
            raise AcceptanceError("Age-matched everyday activity catalogue is incomplete")
        result["goalCount"] = 0
        result["templateCount"] = 4
        return result
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
    parser.add_argument("--reset-synthetic-app", action="store_true", help="Required acknowledgement: clears this app on FocusIslandQA")
    parser.add_argument("--offline-recovery", action="store_true", help="Remove the API port, force-stop, recover offline, then sync")
    args = parser.parse_args()
    if not args.reset_synthetic_app:
        parser.error("--reset-synthetic-app is required because the dedicated emulator app data will be cleared")
    device = Device(args.adb, args.serial)
    try:
        validate_target(device, args.api_base, args.apk)
        result = run_flow(device, args.api_base, args.apk, args.evidence_dir, args.offline_recovery)
        print(json.dumps(result, indent=2))
        if not result["familyDeleted"] or not result["appDataCleared"]:
            raise AcceptanceError("Synthetic data cleanup did not finish")
        return 0
    except (AcceptanceError, ET.ParseError, subprocess.TimeoutExpired, OSError, urllib.error.URLError) as error:
        print(f"Android acceptance failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
