import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "xlabtv"))
import settings  # noqa: E402


class FakeRun:
    """Answers commands from a table; records every call."""

    def __init__(self, table):
        self.table, self.calls = table, []

    def __call__(self, cmd, timeout=15):
        self.calls.append(cmd)
        for prefix, answer in self.table.items():
            if tuple(cmd[:len(prefix)]) == prefix:
                return answer(cmd) if callable(answer) else answer
        return (0, "", "")


WIFI_LIST = ("*:Home\\:5G:82:WPA2\n"
             " :Home\\:5G:40:WPA2\n"
             " :Cafe:55:\n"
             " ::30:WPA2\n")
WIFI = {
    ("nmcli", "radio", "wifi"): (0, "enabled\n", ""),
    ("nmcli", "-t", "-f", "TYPE,STATE,CONNECTION", "device"): (0, "ethernet:connected:Wired\nwifi:connected:Home\\:5G\n", ""),
    ("nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY"): (0, WIFI_LIST, ""),
    ("nmcli", "-t", "-f", "TYPE,DEVICE", "device"): (0, "ethernet:enp2s0\nwifi:wlp1s0\n", ""),
    ("nmcli", "device", "wifi", "connect", "Cafe"): (10, "", "Error: Connection activation failed: Secrets were required.\n"),
}


class WifiTests(unittest.TestCase):
    def test_status(self):
        st = settings.wifi_status(FakeRun(WIFI))
        self.assertTrue(st["enabled"] and st["ethernet"])
        self.assertEqual(st["connected"], {"ssid": "Home:5G", "signal": 82})
        self.assertEqual([n["ssid"] for n in st["networks"]], ["Home:5G", "Cafe"])  # deduped, hidden skipped
        self.assertFalse(st["networks"][1]["secure"])

    def test_connect_error_and_password(self):
        run = FakeRun(WIFI)
        with self.assertRaises(settings.SettingsError) as ctx:
            settings.wifi_action({"action": "connect", "ssid": "Cafe"}, run)
        self.assertIn("Secrets were required", str(ctx.exception))
        settings.wifi_action({"action": "connect", "ssid": "Home:5G", "password": "pw"}, run)
        self.assertIn(["nmcli", "device", "wifi", "connect", "Home:5G", "password", "pw"], run.calls)

    def test_disconnect_wifi_only(self):
        run = FakeRun(WIFI)
        settings.wifi_action({"action": "disconnect"}, run)
        self.assertIn(["nmcli", "device", "disconnect", "wlp1s0"], run.calls)
        self.assertNotIn(["nmcli", "device", "disconnect", "enp2s0"], run.calls)


BT = {
    ("bluetoothctl", "show"): (0, "Controller 11:22:33:44:55:66 (public)\n\tPowered: yes\n", ""),
    ("bluetoothctl", "devices", "Paired"): (0, "Device AA:BB:CC:DD:EE:01 Xbox Wireless Controller\n", ""),
    ("bluetoothctl", "devices", "Connected"): (0, "Device AA:BB:CC:DD:EE:01 Xbox Wireless Controller\n", ""),
    ("bluetoothctl", "devices"): (0, "Device AA:BB:CC:DD:EE:01 Xbox Wireless Controller\n"
                                     "Device AA:BB:CC:DD:EE:02 WH-1000XM5\n", ""),
}


class BluetoothTests(unittest.TestCase):
    def test_status(self):
        st = settings.bluetooth_status(FakeRun(BT))
        self.assertTrue(st["available"] and st["powered"])
        self.assertEqual(st["devices"][0], {"mac": "AA:BB:CC:DD:EE:01", "name": "Xbox Wireless Controller",
                                            "paired": True, "connected": True})
        self.assertFalse(st["devices"][1]["paired"])

    def test_no_adapter(self):
        st = settings.bluetooth_status(FakeRun({("bluetoothctl", "show"): (1, "", "No default controller")}))
        self.assertEqual(st, {"available": False, "powered": False, "devices": []})

    def test_pair_trusts_and_connects(self):
        run = FakeRun(BT)
        settings.bluetooth_action({"action": "pair", "mac": "aa:bb:cc:dd:ee:02"}, run)
        verbs = [c[1] for c in run.calls if c[1] in ("pair", "trust", "connect")]
        self.assertEqual(verbs, ["pair", "trust", "connect"])
        with self.assertRaises(settings.SettingsError):
            settings.bluetooth_action({"action": "pair", "mac": "nope; rm -rf /"}, run)


SINKS = [
    {"name": "alsa_output.pci-0000_00_1f.3.hdmi-stereo", "description": "HDMI / TV", "mute": False,
     "volume": {"front-left": {"value": 26214, "value_percent": "40%", "db": "-23.88 dB"},
                "front-right": {"value": 26214, "value_percent": "40%", "db": "-23.88 dB"}}},
    {"name": "bluez_output.AA_BB", "description": "WH-1000XM5", "mute": True,
     "volume": {"front-left": {"value_percent": "70%"}}},
]
AUDIO = {
    ("pactl", "-f", "json", "list", "sinks"): (0, json.dumps(SINKS), ""),
    ("pactl", "get-default-sink"): (0, "alsa_output.pci-0000_00_1f.3.hdmi-stereo\n", ""),
}


class AudioTests(unittest.TestCase):
    def test_status(self):
        st = settings.audio_status(FakeRun(AUDIO))
        self.assertEqual((st["volume"], st["muted"]), (40, False))
        self.assertEqual([o["name"] for o in st["outputs"] if o["default"]], ["HDMI / TV"])

    def test_actions(self):
        run = FakeRun(AUDIO)
        settings.audio_action({"action": "up"}, run)
        self.assertIn(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "45%"], run.calls)
        settings.audio_action({"action": "volume", "level": 250}, run)
        self.assertIn(["pactl", "set-sink-volume", "@DEFAULT_SINK@", "100%"], run.calls)
        settings.audio_action({"action": "output", "id": "bluez_output.AA_BB"}, run)
        self.assertIn(["pactl", "set-default-sink", "bluez_output.AA_BB"], run.calls)
        with self.assertRaises(settings.SettingsError):
            settings.audio_action({"action": "output", "id": "evil"}, run)


class UpdatesTests(unittest.TestCase):
    def test_counts(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = Path(tmp) / "source-dir"
            src.write_text("/home/u/xlabtv\n")
            run = FakeRun({
                ("git", "-C", "/home/u/xlabtv", "fetch"): (0, "", ""),
                ("git", "-C", "/home/u/xlabtv", "rev-list"): (0, "3\n", ""),
                ("flatpak", "remote-ls"): (0, "rocks.shy.VacuumTube\norg.videolan.VLC\n", ""),
                ("/usr/lib/update-notifier/apt-check",): (0, "", "12;3"),
            })
            st = settings.UpdateChecker(src, run, start=False).check()
        self.assertEqual((st["xlabtv"], st["apps"], st["system"], st["total"]), (True, 2, 12, 15))

    def test_nothing_available(self):
        def boom(cmd, timeout=15):
            raise settings.SettingsError("missing")
        st = settings.UpdateChecker(Path("/nonexistent"), boom, start=False).check()
        self.assertEqual(st["total"], 0)


class PagesTests(unittest.TestCase):
    def test_only_known_pages(self):
        opened = []
        settings.open_settings_page("display", lambda cmd, **kw: opened.append(cmd))
        self.assertEqual(opened, [["gnome-control-center", "display"]])
        with self.assertRaises(settings.SettingsError):
            settings.open_settings_page("--evil", lambda cmd, **kw: None)


if __name__ == "__main__":
    unittest.main()
