#!/usr/bin/env python3
"""Control and record either headless instrument. No third-party dependencies."""
import argparse
import array
import json
import sys
import time
import wave
from pathlib import Path
from protocol import connect, receive, send


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", default="127.0.0.1:7007")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ["status", "panic", "functions"]:
        sub.add_parser(name)
    for name in ["dump", "bank", "load"]:
        sub.add_parser(name).add_argument("file", type=Path)
    sub.add_parser("store").add_argument("slot", type=int)
    sub.add_parser("bank-start").add_argument("slot", type=int)
    sub.add_parser("midi").add_argument("hex", help='e.g. "90 3c 64"')
    render = sub.add_parser("record")
    render.add_argument("file", type=Path)
    render.add_argument("--seconds", type=float, default=3)
    render.add_argument("--note", type=int, help="optional MIDI note to audition")
    render.add_argument("--velocity", type=int, default=100)
    render.add_argument("--hold", type=float, default=1)
    args = parser.parse_args()
    with connect(args.address)[0] as sock:
        if args.command == "record":
            if not 0 < args.seconds <= 3600 or args.hold < 0 or not 0 <= args.velocity <= 127 or (args.note is not None and not 0 <= args.note <= 127):
                parser.error("invalid recording duration, note, or velocity")
            send(sock, 3, [4])
            _, data = receive(sock)
            channel = json.loads(data)["receive_channel"] - 1
            send(sock, 4, [2])
            # Drain the subscribe acknowledgement before timing captured audio.
            while receive(sock)[0] != 5:
                pass
            if args.note is not None:
                send(sock, 1, [144 + channel, args.note, args.velocity])
            remaining = int(args.seconds * 48000)
            written = 0
            released = False
            with wave.open(str(args.file), "wb") as wav:
                wav.setparams((2, 2, 48000, 0, "NONE", "not compressed"))
                while remaining:
                    kind, data = receive(sock)
                    if kind == 6:
                        raise RuntimeError(data.decode())
                    if kind != 2:
                        continue
                    values = array.array("f", data)
                    if sys.byteorder != "little":
                        values.byteswap()
                    count = min(remaining, len(values) // 2)
                    pcm = array.array("h", (int(max(-1, min(1, x)) * 32767) for x in values[:count * 2]))
                    if sys.byteorder != "little":
                        pcm.byteswap()
                    wav.writeframesraw(pcm.tobytes())
                    written += count
                    remaining -= count
                    if args.note is not None and not released and written >= args.hold * 48000:
                        send(sock, 1, [144 + channel, args.note, 0])
                        released = True
            if args.note is not None:
                send(sock, 1, [144 + channel, args.note, 0])
            print(args.file)
            return
        if args.command == "load":
            data = args.file.read_bytes()
            if not data or data[0] != 240 or data[-1] != 247:
                parser.error("expected a framed SysEx file")
            for offset in range(0, len(data), 8192):
                send(sock, 1, data[offset:offset + 8192])
            send(sock, 3, [4])
        elif args.command == "midi":
            send(sock, 1, bytes.fromhex(args.hex))
            send(sock, 3, [4])
        else:
            commands = {"dump": 0, "bank": 1, "store": 2, "panic": 3, "status": 4, "bank-start": 5, "functions": 6}
            data = [commands[args.command]]
            if hasattr(args, "slot"):
                if not 0 <= args.slot < 128:
                    parser.error("slot must be 0–127 (instrument range is checked by server)")
                data.append(args.slot)
            send(sock, 3, data)
        messages = bytearray()
        while True:
            kind, data = receive(sock)
            if kind == 6:
                raise RuntimeError(data.decode())
            if kind == 1:
                messages.extend(data)
            if kind == 5:
                if args.command in ("dump", "bank"):
                    args.file.write_bytes(messages)
                    print(f"{args.file}: {len(messages)} SysEx bytes")
                elif args.command == "functions":
                    print(messages.hex(" "))
                else:
                    print(json.dumps(json.loads(data), indent=2))
                break


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
