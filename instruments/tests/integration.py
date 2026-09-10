#!/usr/bin/env python3
"""End-to-end TCP/optional native-MIDI acceptance. Restores voices and banks."""
import argparse
import array
import json
import queue
import socket
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "bridge"))
from protocol import connect, receive, send

FIXTURES = Path(__file__).parent / "fixtures"


def command(sock, data):
    send(sock, 3, data)
    messages = bytearray()
    while True:
        kind, payload = receive(sock)
        if kind == 6:
            raise AssertionError(payload.decode())
        if kind == 1:
            messages.extend(payload)
        if kind == 5:
            return bytes(messages), json.loads(payload)


def load(sock, data):
    for start in range(0, len(data), 101):
        send(sock, 1, data[start:start + 101])
    command(sock, [4])


def test(model, address, native):
    sock, greeting = connect(address)
    original_status = json.loads(greeting)
    current, _ = command(sock, [0])
    bank, _ = command(sock, [1])
    try:
        original = (FIXTURES / f"{model}-original.syx").read_bytes()
        final = (FIXTURES / f"{model}-final.syx").read_bytes()
        load(sock, original)
        assert command(sock, [0])[0] == original
        load(sock, (FIXTURES / f"{model}-edits.syx").read_bytes())
        assert command(sock, [0])[0] == final, f"{model} parameter edits differ"
        expected_bank = (FIXTURES / f"{model}-bank.syx").read_bytes()
        load(sock, expected_bank)
        assert command(sock, [1])[0] == expected_bank
        corrupt = bytearray(expected_bank)
        corrupt[-2] ^= 1
        send(sock, 1, corrupt)
        assert receive(sock)[0] == 6
        assert command(sock, [1])[0] == expected_bank, "invalid bank changed memory"
        # Store and recall via actual Program Change.
        command(sock, [2, 31])
        send(sock, 1, [192, 31])
        assert command(sock, [0])[0] == final
        command(sock, [3])
        load(sock, original)
        send(sock, 4, [3])
        while receive(sock)[0] != 5:
            pass
        send(sock, 1, [144, 69, 127])
        samples = []
        for _ in range(20):
            while True:
                kind, data = receive(sock)
                if kind == 2:
                    samples.extend(array.array("f", data))
                    break
        assert max(abs(x) for x in samples) > 0.005, f"{model} silent"
        command(sock, [3])
        send(sock, 4, [1])
        while receive(sock)[0] != 5:
            pass
        # Losing one controller connection must not silence another controller.
        second, _ = connect(address)
        send(sock, 1, [144, 69, 100])
        send(second, 1, [144, 76, 100])
        command(second, [4])
        assert command(sock, [4])[1]["active_notes"] == 2
        second.close()
        time.sleep(0.1)
        assert command(sock, [4])[1]["active_notes"] == 1
        command(sock, [3])
        if native:
            import rtmidi
            incoming = rtmidi.MidiIn()
            outgoing = rtmidi.MidiOut()
            incoming.ignore_types(sysex=False, timing=False, active_sense=False)
            incoming.open_port(incoming.get_ports().index(model.upper() + " Emulator OUT"))
            outgoing.open_port(outgoing.get_ports().index(model.upper() + " Emulator IN"))
            received = queue.Queue()
            incoming.set_callback(lambda event, _: received.put(bytes(event[0])))
            try:
                # Actual native MIDI -> host bridge -> container -> native MIDI.
                start = 0
                for i, byte in enumerate(final):
                    if byte == 247:
                        outgoing.send_message(list(final[start:i + 1]))
                        start = i + 1
                        time.sleep(0.05)
                time.sleep(0.1)
                while not received.empty():
                    received.get_nowait()
                if model == "ys200":
                    outgoing.send_message([240, 67, 32, 126] + list(b"LM  8036EF") + [247])
                else:
                    command(sock, [0])  # headless equivalent of the DX7 front-panel dump
                data = b""
                while len(data) < len(final):
                    data += received.get(timeout=3)
                assert data == final, f"{model} native MIDI dump differed"
            finally:
                incoming.close_port()
                outgoing.close_port()
        print(f"{model}: MIDI/SysEx, all editor edits, bank, rejection, store/recall, stereo audio" + (", native MIDI roundtrip" if native else "") + " PASS")
    finally:
        command(sock, [3])
        load(sock, bank)
        send(sock, 1, [192, original_status["program"]])
        load(sock, current)
        sock.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dx7", default="127.0.0.1:7007")
    parser.add_argument("--ys200", default="127.0.0.1:7200")
    parser.add_argument("--native", action="store_true")
    args = parser.parse_args()
    for model in ["dx7", "ys200"]:
        test(model, getattr(args, model), args.native)
