"""Isolated browser acceptance for a real family flow, using fictional data only."""

import json
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

from playwright.sync_api import expect, sync_playwright


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


def verify_candidate_is_served(base):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(base + "/index.html", timeout=10) as response:
        received = response.read()
    expected = (ROOT / "dist/web/index.html").read_bytes()
    assert received == expected, "Browser acceptance must serve the newly built candidate rather than a retained release"


def play_one_formal_step(page):
    page.get_by_role("button", name="Start today’s practice").click()
    invitation = page.get_by_role("dialog")
    invitation.get_by_text("Please hand the screen to your child", exact=False).wait_for()
    assert "Please hand the screen to your child" in invitation.inner_text()
    invitation.get_by_label("Touch, mouse or keyboard").check()
    page.get_by_role("button", name="I want to start").click()
    examples = page.get_by_role("group", name="Examples for this rule")
    expect(examples).to_be_visible()
    assert examples.get_by_role("img", name="Rabbit").count() == 1
    for label in ("Fox", "Bear", "Cat"):
        assert examples.get_by_role("img", name=label).count() == 1
    expect(examples.get_by_text("Find all of these")).to_be_visible()
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
    page.get_by_role("button", name="If you like, explore an everyday goal").click()
    page.get_by_role("heading", name="One small goal. You can stop at any time.").wait_for(timeout=10000)
    assert page.get_by_role("radio", name=re.compile("Find two little things")).is_checked()
    goals = page.evaluate("""async () => {
      const me = await (await fetch('/api/me')).json();
      return (await (await fetch(`/api/children/${me.children[0].id}/life-goals`)).json()).goals;
    }""")
    assert goals == [], "Opening a related activity must not save a goal without the child's choice"
    page.get_by_role("button", name="Today", exact=True).first.click()


def play_assistive_search(page):
    page.locator(".task-card").first.click()
    invitation = page.get_by_role("dialog")
    begin = invitation.get_by_role("button", name="I want to start")
    assert begin.is_disabled(), "Input mode must be chosen explicitly"
    invitation.get_by_label("Screen reader (recorded separately)").check()
    assert begin.is_enabled()
    begin.click()
    page.get_by_text("This screen reader practice has no per-step countdown", exact=False).wait_for()
    page.get_by_role("button", name="I want to try").click()
    for step in range(3):
        page.get_by_role("button", name="All found").wait_for(timeout=15000)
        assert page.evaluate("document.activeElement?.classList.contains('task-heading')"), "New screen reader step should focus its heading"
        for rabbit in page.locator('button.stimulus-tile[aria-label^="Rabbit"]').all():
            rabbit.focus()
            page.keyboard.press("Enter")
        page.get_by_role("button", name="All found").click()
        page.locator(".feedback-stage").wait_for(timeout=15000)
        if step < 2:
            page.locator(".feedback-stage button.primary").click()
    page.get_by_role("button", name="Take a break").click()
    page.get_by_role("button", name="That is enough for today").click()
    page.get_by_text("formal screen reader steps, kept separately", exact=False).wait_for(timeout=10000)
    page.get_by_text("Your record has been checked and saved for your family.").wait_for(timeout=15000)
    page.get_by_role("button", name="Done, time for a break").click()


def check_assistive_memory_focus(page):
    page.locator(".task-card").nth(2).click()
    invitation = page.get_by_role("dialog")
    invitation.get_by_label("Screen reader (recorded separately)").check()
    invitation.get_by_role("button", name="I want to start").click()
    page.get_by_role("button", name="I want to try").click()
    page.get_by_role("button", name="Ready, hide them").wait_for(timeout=15000)
    page.get_by_role("button", name="Ready, hide them").click()
    page.locator(".memory-options button").first.wait_for(timeout=15000)
    page.wait_for_function("document.activeElement === document.querySelector('.memory-options button')")
    page.get_by_role("button", name="Take a break").click()
    page.get_by_role("button", name="That is enough for today").click()
    page.get_by_role("button", name="Done, time for a break").click()


def verify_practice_limit_refresh(page):
    snapshot = page.evaluate("""async () => {
      const me = await (await fetch('/api/me')).json();
      return (await (await fetch(`/api/children/${me.children[0].id}/practice-limits`)).json());
    }""")
    reads = 0
    writes = 0

    def response(route):
        nonlocal reads, writes
        if route.request.method != "GET":
            writes += 1
            route.continue_()
            return
        reads += 1
        if reads == 3:
            route.abort()
            return
        value = dict(snapshot, timezone="UTC", day="2026-10-01", nextDay="2026-10-02", generatedAt="2026-10-01T12:00:00Z")
        if reads >= 2:
            value.update(confirmedMs=60000, availableMs=420000)
        if reads == 5:
            value["generatedAt"] = "2026-10-01T23:59:58Z"
        if reads >= 6:
            value.update(day="2026-10-02", nextDay="2026-10-03", generatedAt="2026-10-02T00:00:01Z", confirmedMs=0, availableMs=480000)
        route.fulfill(status=200, content_type="application/json", body=json.dumps(value))

    pattern = "**/api/children/*/practice-limits"
    page.route(pattern, response)
    try:
        page.get_by_role("button", name="Practice & rest", exact=True).first.click()
        maximum = page.get_by_label("New daily maximum")
        confirmation = page.get_by_label("I understand the effective date and will discuss the plan with my child.")
        save = page.get_by_role("button", name="Save future plan")
        maximum.select_option("2")
        confirmation.check()
        expect(save).to_be_enabled()
        with page.expect_response(lambda item: "/practice-limits" in item.url):
            page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(save).to_be_enabled()
        expect(maximum).to_have_value("2")
        expect(confirmation).to_be_checked()
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        page.get_by_text("The latest plan could not be confirmed.", exact=False).wait_for()
        expect(maximum).to_have_value("2")
        expect(confirmation).to_be_checked()
        expect(save).to_be_disabled()
        page.get_by_role("button", name="Refresh today’s status").click()
        expect(save).to_be_enabled()
        expect(maximum).to_have_value("2")
        with page.expect_response(lambda item: "/practice-limits" in item.url):
            page.evaluate("window.dispatchEvent(new Event('focus'))")
        expect(save).to_be_enabled()
        page.get_by_text("Family date 2026-10-02 · UTC", exact=True).wait_for(timeout=10000)
        expect(confirmation).not_to_be_checked()
        expect(maximum).to_have_value("8")
        expect(save).to_be_disabled()
        assert reads >= 6, "The family midnight did not trigger a new read"
        assert writes == 0, "Refreshing must never submit an unsaved family arrangement"
        print("PASS practice plan refresh: foreground and transient failure keep unsaved choice; stale data blocks saving; server family midnight clears old acknowledgement; no automatic write")
    finally:
        page.unroute(pattern, response)
        page.get_by_role("button", name="Today", exact=True).first.click()


def verify_invitation_refresh_and_race(page):
    snapshot = page.evaluate("""async () => {
      const me = await (await fetch('/api/me')).json();
      return (await (await fetch(`/api/children/${me.children[0].id}/practice-limits`)).json());
    }""")
    reads = 0
    starts = []

    def observe(request):
        if request.method == "POST" and re.search(r"/api/children/[^/]+/sessions$", request.url):
            starts.append(request.post_data_json)

    def response(route):
        nonlocal reads
        reads += 1
        value = dict(snapshot, timezone="UTC", day="2026-10-01", nextDay="2026-10-02", generatedAt="2026-10-01T23:59:58Z")
        if reads >= 2:
            value.update(day="2026-10-02", nextDay="2026-10-03", generatedAt="2026-10-02T00:00:01Z", currentMinutes=0, availableMs=0, status="paused")
        route.fulfill(status=200, content_type="application/json", body=json.dumps(value))

    pattern = "**/api/children/*/practice-limits"
    page.on("request", observe)
    page.route(pattern, response)
    try:
        page.get_by_role("button", name="Start today’s practice").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Touch, mouse or keyboard").check()
        begin = dialog.get_by_role("button", name="I want to start")
        expect(begin).to_be_enabled()
        dialog.get_by_text("Your family has planned a rest day", exact=False).wait_for(timeout=10000)
        expect(begin).to_be_disabled()
        dialog.get_by_text("Your family’s plan has updated", exact=False).wait_for()
        assert starts == [], "A day refresh must not decide to start for the child"
        dialog.get_by_role("button", name="Not now", exact=True).click()
    finally:
        page.unroute(pattern, response)

    try:
        page.get_by_role("button", name="Start today’s practice").click()
        dialog = page.get_by_role("dialog")
        dialog.get_by_label("Touch, mouse or keyboard").check()
        expect(dialog.get_by_role("button", name="I want to start")).to_be_enabled()
        changed = page.evaluate("""async () => {
          const me = await (await fetch('/api/me')).json();
          const id = me.children[0].id;
          const plan = await (await fetch(`/api/children/${id}/practice-limits`)).json();
          const result = await fetch(`/api/children/${id}/practice-limits`, {method:'PATCH',
            headers:{'Content-Type':'application/json','X-CSRF-Token':me.csrf,'If-Match':`"${plan.settingsVersion}"`},
            body:JSON.stringify({minutes:3,effectiveDay:plan.nextDay,acknowledged:true})});
          return result.status;
        }""")
        assert changed == 200
        with page.expect_response(lambda item: re.search(r"/children/[^/]+/sessions$", item.url)) as rejected:
            dialog.get_by_role("button", name="I want to start").click()
        assert rejected.value.status == 409
        page.get_by_text("Today’s plan has updated.", exact=False).wait_for()
        assert len(starts) == 1 and starts[0]["practiceReview"]["version"] == "practice-start-review-1"
        state = page.evaluate("""async () => {
          const me = await (await fetch('/api/me')).json();
          const report = await (await fetch(`/api/children/${me.children[0].id}/report`)).json();
          return {role:me.role, records:report.sessions.length};
        }""")
        assert state == {"role": "parent", "records": 0}, "Rejected review must not create a practice or replace parent access"
        print("PASS practice invitation: midnight rest blocks start; changed plan rejects the submitted old review without records or credential rotation")
    finally:
        page.remove_listener("request", observe)


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
        page.set_viewport_size({"width": 320, "height": 780})
        assert page.evaluate("document.body.scrollWidth <= innerWidth"), "Family home overflows a 320px viewport"
        page.get_by_role("button", name="Add a child").first.click()
        dialog_bounds = page.get_by_role("dialog").evaluate("el => ({left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right})")
        assert dialog_bounds["left"] >= -1 and dialog_bounds["right"] <= 321, f"Child profile dialog overflows a 320px viewport: {dialog_bounds}"
        page.get_by_label("Child’s nickname").fill(CHILD)
        page.get_by_label("Age band").select_option("6-8")
        page.get_by_label("Practice language").select_option("en")
        page.get_by_label(re.compile("I agree to save local test records")).check()
        page.get_by_role("button", name="Prepare their space").click()
        page.get_by_role("button", name="Start today’s practice").wait_for(timeout=10000)
        assert page.evaluate("document.body.scrollWidth <= innerWidth"), "Practice selection overflows a 320px viewport"
        page.set_viewport_size({"width": 1440, "height": 900})

        verify_practice_limit_refresh(page)
        verify_invitation_refresh_and_race(page)

        page.locator(".task-card").nth(1).click()
        timed_invitation = page.get_by_role("dialog")
        assert timed_invitation.get_by_label("Screen reader (recorded separately)").is_disabled()
        assert "This timed visual task is not available with a screen reader yet" in timed_invitation.inner_text()
        timed_invitation.get_by_role("button", name="Close").click()
        play_one_formal_step(page)
        page.get_by_role("button", name="Start today’s practice").click()
        page.get_by_role("dialog").get_by_text("You have already practised today", exact=False).wait_for()
        invitation = page.get_by_role("dialog").inner_text()
        assert "You have already practised today" in invitation
        assert "there is no need to use the remaining time" in invitation
        page.get_by_role("dialog").get_by_role("button", name="Close").click()
        play_assistive_search(page)
        check_assistive_memory_focus(page)
        page.get_by_role("button", name="Parent access").click()
        parent_dialog = page.get_by_role("dialog")
        parent_dialog.get_by_label("Family name").fill(FAMILY)
        parent_dialog.get_by_label("Parent password").fill(PASSWORD)
        parent_dialog.get_by_role("button", name="Open family space").click()
        page.get_by_role("button", name="Progress").first.click()
        page.get_by_text("Screen reader · separate record").first.wait_for(timeout=15000)
        page.get_by_text("Kept separately; no accuracy or ability change calculated").first.wait_for(timeout=15000)
        assert not errors, f"Browser runtime errors: {errors}"

        snapshot = page.evaluate("""async () => {
          const me = await (await fetch('/api/me')).json();
          return (await (await fetch(`/api/children/${me.children[0].id}/practice-limits`)).json());
        }""")
        assert snapshot["confirmedMs"] > 0, "The service did not confirm active practice time"
        assert snapshot["status"] == "available", "A short practice should leave voluntary time"
        print("PASS family flow: 320px home and profile dialog, voluntary start, formal step, separate keyboard-operated screen reader condition, server confirmation, same-day rest cue")
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
        page.get_by_role("button", name="Welcome back").click()
        page.get_by_label("Family name").fill(FAMILY)
        page.get_by_label("Parent password").fill("incorrect synthetic password")
        page.get_by_role("button", name="Open family space").click()
        page.get_by_text("The family name or password is incorrect, or sign-in is temporarily unavailable.").wait_for()
        print("PASS mobile entry: 390px viewport without overflow; failed sign-in stays in English")
    finally:
        page.close()


def verify_first_language(browser, base):
    for browser_language, expected_heading in [
        ("zh-CN", "专注于眼前，"),
        ("zh-TW", "Find your focus."),
    ]:
        page = browser.new_page(locale=browser_language)
        try:
            page.goto(base, wait_until="networkidle")
            page.get_by_role("heading", name=re.compile(re.escape(expected_heading))).wait_for()
            expected_locale = "zh-CN" if browser_language == "zh-CN" else "en"
            assert page.evaluate("document.documentElement.lang") == expected_locale
            if browser_language == "zh-TW":
                page.get_by_role("button", name="简体中文").click()
                page.get_by_role("heading", name=re.compile("专注于眼前")).wait_for()
                page.reload(wait_until="networkidle")
                page.get_by_role("heading", name=re.compile("专注于眼前")).wait_for()
                assert page.evaluate("localStorage.getItem('focus-ui-locale')") == "zh-CN"
        finally:
            page.close()
    print("PASS language entry: Simplified Chinese, Traditional Chinese fallback, saved manual choice")


def main():
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="focus-browser-qa-") as data_dir:
        env = dict(os.environ)
        for name in list(env):
            if name.startswith(("FOCUS_", "VERCEL")) or name.startswith("DATABASE_"):
                env.pop(name)
        env.update({"APP_MODE": "local", "DATABASE_URL": "", "API_PORT": str(port), "STUDIO_PORT": "0", "FOCUS_DATA_DIR": data_dir,
                    "FOCUS_WEB_RELEASE_DIR": str(Path(data_dir) / "unused-web-releases")})
        server = subprocess.Popen([shutil.which("node") or "node", "apps/api/main.ts"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        try:
            wait_for_server(server, base)
            verify_candidate_is_served(base)
            with sync_playwright() as playwright:
                launch = {"headless": True, "args": ["--no-sandbox"]}
                if os.environ.get("FOCUS_BROWSER_PATH"):
                    launch["executable_path"] = os.environ["FOCUS_BROWSER_PATH"]
                browser = playwright.chromium.launch(**launch)
                try:
                    verify_family_flow(browser, base)
                    verify_mobile_entry(browser, base)
                    verify_first_language(browser, base)
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
