import unittest

from scripts.qa.android_practice_life import AcceptanceError, Device


class AudioObservations(unittest.TestCase):
    def setUp(self):
        self.device = Device("unused-adb", "emulator-5554")
        self.creation = "10-12 08:00:00 new player piid:7 uid/pid:10123/500 type:android.media.AudioTrack"

    def test_android_11_state_transitions(self):
        after = self.creation + "\n10-12 08:00:01 player piid:7 state:started\n10-12 08:00:02 player piid:7 state:paused"
        self.assertEqual(self.device.app_audio_states_since(self.creation, after, "10123"), [("7", "started"), ("7", "paused")])

    def test_modern_event_transitions_with_evicted_creation(self):
        after = "10-12 08:00:01 player piid:7 event:started\n10-12 08:00:02 player piid:7 event:stopped"
        self.assertEqual(self.device.app_audio_states_since(self.creation, after, "10123"), [("7", "started"), ("7", "stopped")])

    def test_live_configuration_can_associate_the_app_player(self):
        before = "AudioPlaybackConfiguration piid:7 type:android.media.AudioTrack u/pid:10123/500 state:paused"
        after = "10-12 08:00:01 player piid:7 event:started\n10-12 08:00:02 releasing player piid:7, uid:10123"
        self.assertEqual(self.device.app_audio_states_since(before, after, "10123"), [("7", "started"), ("7", "released")])

    def test_old_playback_and_other_uids_are_not_new_app_playback(self):
        before = self.creation + "\n10-12 08:00:01 player piid:7 state:started"
        after = before + "\n10-12 08:00:02 new player piid:8 uid/pid:101234/600\n10-12 08:00:03 player piid:8 event:started"
        self.assertFalse(self.device.app_audio_started_since(before, after, "10123"))

    def test_started_then_paused_is_required_for_interruption(self):
        self.device.run = lambda *args: self.creation + "\n10-12 08:00:01 player piid:7 event:started\n10-12 08:00:02 player piid:7 event:paused"
        self.device.verify_audio_interrupted(self.creation, "10123", None, "background")

    def test_a_player_still_started_fails_interruption(self):
        self.device.run = lambda *args: self.creation + "\n10-12 08:00:01 player piid:7 event:started"
        with self.assertRaisesRegex(AcceptanceError, "did not stop"):
            self.device.verify_audio_interrupted(self.creation, "10123", None, "background")

    def test_pause_followed_by_a_new_start_is_not_stopped(self):
        self.device.run = lambda *args: self.creation + "\n10-12 08:00:01 player piid:7 event:started\n10-12 08:00:02 player piid:7 event:paused\n10-12 08:00:03 player piid:7 event:started"
        with self.assertRaisesRegex(AcceptanceError, "did not stop"):
            self.device.verify_audio_interrupted(self.creation, "10123", None, "lockscreen")

    def test_missing_start_is_not_an_interruption_pass(self):
        self.device.run = lambda *args: self.creation + "\n10-12 08:00:02 player piid:7 event:paused"
        with self.assertRaisesRegex(AcceptanceError, "No system playback"):
            self.device.verify_audio_interrupted(self.creation, "10123", None, "lockscreen")


if __name__ == "__main__":
    unittest.main()
