#!/usr/bin/env python3
"""Manage the macOS user LaunchAgent that owns the virtual MIDI ports."""
import os
from pathlib import Path
import plistlib
import subprocess
import sys

LABEL = "com.ys200-editor.midi-bridge"
BRIDGE = Path(__file__).resolve().parent


def main():
    if sys.platform != "darwin":
        raise SystemExit("The background service is macOS-only; use start.sh --foreground.")
    action = sys.argv[1] if len(sys.argv) > 1 else "status"
    domain = f"gui/{os.getuid()}"
    target = f"{domain}/{LABEL}"
    plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    logs = Path.home() / "Library" / "Logs" / "ys200-editor"
    if action == "status":
        raise SystemExit(subprocess.call(["launchctl", "print", target]))
    if action == "restart":
        subprocess.run(["launchctl", "kickstart", "-k", target], check=True)
        return
    if action == "uninstall":
        subprocess.run(["launchctl", "bootout", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        plist.unlink(missing_ok=True)
        print("MIDI bridge service removed; instrument containers are unchanged.")
        return
    if action != "install":
        raise SystemExit("Usage: service.py install [bridge options] | status | restart | uninstall")
    python = BRIDGE / ".venv" / "bin" / "python"
    if not python.exists():
        raise SystemExit("Run sh instruments/bridge/start.sh to create the bridge environment first.")
    plist.parent.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)
    config = {
        "Label": LABEL,
        "ProgramArguments": [str(python), "-u", str(BRIDGE / "host.py"), *sys.argv[2:]],
        "WorkingDirectory": str(BRIDGE),
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "LimitLoadToSessionType": "Aqua",
        "StandardOutPath": str(logs / "midi-bridge.log"),
        "StandardErrorPath": str(logs / "midi-bridge-error.log"),
    }
    # Reinstall replaces this service instead of creating duplicate MIDI ports.
    subprocess.run(["launchctl", "bootout", target], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    temporary = plist.with_suffix(".tmp")
    temporary.write_bytes(plistlib.dumps(config))
    temporary.replace(plist)
    subprocess.run(["launchctl", "bootstrap", domain, str(plist)], check=True)
    print(f"MIDI bridge runs in the background and starts at login ({LABEL}).")
    print(f"Logs: {logs}")


if __name__ == "__main__":
    main()
