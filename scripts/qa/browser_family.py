"""Isolated browser acceptance for a real family flow, using fictional data only."""

import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[2]
FAMILY = "Synthetic browser acceptance family"
PASSWORD = "Synthetic-browser-acceptance-2026!"
CHILD = "Synthetic Wren"


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def wait_for_server(server, base):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        if server.poll() is not None:
            raise RuntimeError(f"Local family service exited with status {server.returncode}")
        try:
            with opener.open(f"{base}/api/ready", timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, TimeoutError):
            time.sleep(0.2)
    raise TimeoutError("Local family service did not become ready")


def play_one_formal_step(page):
    page.get_by_role("button", name="Start today’s practice").click()
    invitation = page.get_by_role("dialog")
    assert "Please hand the screen to your child" in invitation.inner_text()
    page.get_by_role("button", name="I want to start").click()
    page.get_by_role("button", name="I want to try").click()

    for step in range(3):
        page.get_by_role("button", name="All found").wait_for(timeout=15000)
        page.wait_for_timeout(300)  # Allow the visible input window to open.
        rabbits = page.locator('button.stimulus-tile[aria-label^="Rabbit"]')
        assert rabbits.count() > 0
        for rabbit in rabbits.all():
            rabbit.click()
        page.get_by_role("button", name="All found").click()
        page.locator(".feedback-stage").wait_for(timeout=15000)
        assert page.locator(".feedback-stage h1").inner_text() == "That step is done"
        if step < 2:
            page.locator(".feedback-stage button.primary").click()

    page.get_by_role("button", name="Take a break").click()
    page.get_by_role("heading", name="A break matters too").wait_for(timeout=10000)
    page.get_by_role("button", name="That is enough for today").click()
    page.get_by_text("You completed 1 independent step.").wait_for(timeout=10000)
    page.get_by_text("Your record has been checked and saved for your family.").wait_for(timeout=15000)
    page.get_by_role("button", name="Done, time for a break").click()


def verify_family_flow(browser, base):
    page = browser.new_page(viewport={"width": 1440, "height": 900}, locale="en-US", timezone_id="America/New_York")
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    try:
        page.goto(base, wait_until="networkidle")
        page.get_by_label("Family name").fill(FAMILY)
        page.get_by_label("Parent password").fill(PASSWORD)
        page.get_by_label(re.compile("I understand this is a local development preview")).check()
        page.get_by_role("button", name="Create our space").click()
        page.get_by_role("heading", name="Meet your first explorer").wait_for(timeout=10000)
        page.get_by_role("button", name="Add a child").first.click()
        page.get_by_label("Child’s nickname").fill(CHILD)
        page.get_by_label("Age band").select_option("6-8")
        page.get_by_label("Practice language").select_option("en")
        page.get_by_label(re.compile("I agree to save local test records")).check()
        page.get_by_role("button", name="Prepare their space").click()
        page.get_by_role("button", name="Start today’s practice").wait_for(timeout=10000)

        play_one_formal_step(page)
        page.get_by_role("button", name="Start today’s practice").click()
        invitation = page.get_by_role("dialog").inner_text()
        assert "You have already practised today" in invitation
        assert "there is no need to use the remaining time" in invitation
        assert not errors, f"Browser runtime errors: {errors}"

        snapshot = page.evaluate("""async () => {
          const me = await (await fetch('/api/me')).json();
          return (await (await fetch(`/api/children/${me.children[0].id}/practice-limits`)).json());
        }""")
        assert snapshot["confirmedMs"] > 0, "The service did not confirm active practice time"
        assert snapshot["status"] == "available", "A short practice should leave voluntary time"
        print("PASS family flow: voluntary start, formal step, server confirmation, same-day rest cue")
    except Exception:
        artifact = ROOT / "dist/browser-qa/failure.png"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(artifact), full_page=True)
        print(f"Browser failure screenshot: {artifact}")
        raise
    finally:
        page.close()


def verify_mobile_entry(browser, base):
    page = browser.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="en-US")
    try:
        page.goto(base, wait_until="networkidle")
        size = page.evaluate("({body: document.body.scrollWidth, viewport: innerWidth})")
        assert size["body"] <= size["viewport"], f"Mobile horizontal overflow: {size}"
        page.get_by_role("button", name="Create our space").wait_for()
        print("PASS mobile entry: 390px viewport without horizontal overflow")
    finally:
        page.close()


def main():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="focus-browser-qa-") as data_dir:
        env = dict(os.environ)
        for name in list(env):
            if name.startswith(("FOCUS_", "VERCEL")) or name.startswith("DATABASE_"):
                env.pop(name)
        env.update({"APP_MODE": "local", "DATABASE_URL": "", "API_PORT": str(port), "STUDIO_PORT": "0", "FOCUS_DATA_DIR": data_dir})
        server = subprocess.Popen([shutil.which("node") or "node", "apps/api/main.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            wait_for_server(server, base)
            with sync_playwright() as playwright:
                launch = {"headless": True, "args": ["--no-sandbox"]}
                if os.environ.get("FOCUS_BROWSER_PATH"):
                    launch["executable_path"] = os.environ["FOCUS_BROWSER_PATH"]
                browser = playwright.chromium.launch(**launch)
                try:
                    verify_family_flow(browser, base)
                    verify_mobile_entry(browser, base)
                finally:
                    browser.close()
        finally:
            server.terminate()
            try:
                server.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                server.kill()
                server.communicate()


if __name__ == "__main__":
    main()
