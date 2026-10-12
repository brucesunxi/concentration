import contextlib
import hashlib
import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.qa import android_practice_life as qa


class InstalledDevice:
    def __init__(self, digest):
        self.digest = digest
        self.serial = "physical-test-device"

    def run(self, *args):
        if args == ("shell", "getprop", "ro.build.characteristics"):
            return "default"
        if args == ("shell", "pm", "path", qa.PACKAGE):
            return "package:/data/app/qa/base.apk"
        if args == ("shell", "sha256sum", "/data/app/qa/base.apk"):
            return self.digest + "  /data/app/qa/base.apk"
        raise AssertionError(f"Unexpected device operation: {args}")


class AndroidDeviceTarget(unittest.TestCase):
    def run_main(self, *, upgrade, installed_old, physical=True):
        with tempfile.TemporaryDirectory() as directory:
            old, new = Path(directory) / "old.apk", Path(directory) / "new.apk"
            old.write_bytes(b"older-test-build")
            new.write_bytes(b"newer-test-build")
            installed = old if installed_old else new
            device = InstalledDevice(hashlib.sha256(installed.read_bytes()).hexdigest())
            argv = ["qa", "--apk", str(new), "--serial", device.serial,
                    "--reset-synthetic-app", "--preinstalled-exact-apk"]
            if physical:
                argv.append("--physical-fresh-test-install")
            if upgrade:
                argv += ["--upgrade-from", str(old), "--offline-recovery"]
            with patch("sys.argv", argv), patch.object(qa, "Device", return_value=device) as factory, \
                    patch.object(qa, "api", return_value=(200, {"status": "ok", "mode": "local-development"})) as api, \
                    patch.object(qa, "run_flow", return_value={"familyDeleted": True, "appDataCleared": True}) as flow, \
                    contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                if not physical:
                    with self.assertRaises(SystemExit) as failure:
                        qa.main()
                    self.assertEqual(failure.exception.code, 2)
                    factory.assert_not_called()
                    flow.assert_not_called()
                    return
                status = qa.main()
                if upgrade and not installed_old:
                    self.assertEqual(status, 1)
                    api.assert_not_called()
                    flow.assert_not_called()
                else:
                    self.assertEqual(status, 0)
                    args = flow.call_args.args
                    self.assertEqual(args[2], new, "Final upgrade target must remain the new APK")
                    self.assertEqual(args[8], old if upgrade else None)
                    self.assertTrue(args[10], "Only the initial verified installation is skipped")

    def test_preinstalled_upgrade_verifies_the_old_build_before_flow(self):
        self.run_main(upgrade=True, installed_old=True)

    def test_installed_new_build_cannot_pass_as_the_old_upgrade_source(self):
        self.run_main(upgrade=True, installed_old=False)

    def test_normal_preinstalled_flow_still_verifies_the_new_build(self):
        self.run_main(upgrade=False, installed_old=False)

    def test_preinstalled_mode_requires_explicit_physical_acknowledgement(self):
        self.run_main(upgrade=True, installed_old=True, physical=False)


if __name__ == "__main__":
    unittest.main()
