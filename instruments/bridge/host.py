#!/usr/bin/env python3
"""Expose Docker instruments as native MIDI ports and play their streamed audio."""
import argparse
import array
from collections import deque
import queue
import socket
import sys
import threading
import time
from protocol import connect, receive, send


class AudioBuffer:
    def __init__(self):
        self.data = deque()
        self.lock = threading.Lock()
        self.ready = False

    def clear(self):
        with self.lock:
            self.data.clear()
            self.ready = False

    def put(self, payload):
        values = array.array("f", payload)
        if sys.byteorder != "little":
            values.byteswap()
        with self.lock:
            self.data.extend(values)
            # Bound latency after OS stalls; discard oldest audio, never MIDI.
            while len(self.data) > 480 * 2 * 8:
                self.data.popleft()
            if len(self.data) >= 480 * 2 * 3:
                self.ready = True

    def take(self, count):
        with self.lock:
            if not self.ready:
                return [0.] * count
            result = [self.data.popleft() if self.data else 0. for _ in range(count)]
            if not self.data:
                self.ready = False
            return result


class Endpoint:
    def __init__(self, name, address, rtmidi, audio):
        self.name, self.address, self.audio = name, address, audio
        self.buffer = AudioBuffer()
        self.stop = threading.Event()
        self.connected = threading.Event()
        self.outgoing = queue.Queue(maxsize=256)
        self.sock = None
        self.midi_in = rtmidi.MidiIn()
        self.midi_in.ignore_types(sysex=False, timing=False, active_sense=False)
        self.midi_in.open_virtual_port(name + " Emulator IN")
        self.midi_out = rtmidi.MidiOut()
        self.midi_out.open_virtual_port(name + " Emulator OUT")
        self.midi_in.set_callback(self.midi)
        self.thread = threading.Thread(target=self.run, daemon=True)
        self.thread.start()

    def midi(self, event, _):
        if not self.connected.is_set():
            return
        try:
            self.outgoing.put_nowait(bytes(event[0]))
        except queue.Full:
            # A reconnect sends panic; do not silently lose a Note Off.
            self.connected.clear()
            if self.sock:
                self.sock.shutdown(socket.SHUT_RDWR)

    def run(self):
        while not self.stop.is_set():
            writer_stop = threading.Event()
            try:
                sock, _ = connect(self.address)
                self.sock = sock
                sock.settimeout(15)
                self.buffer.clear()
                while not self.outgoing.empty():
                    try:
                        self.outgoing.get_nowait()
                    except queue.Empty:
                        break
                send(sock, 3, [3])
                send(sock, 4, [3 if self.audio else 1])
                self.connected.set()
                print(f"{self.name}: connected, ports '{self.name} Emulator IN/OUT'", flush=True)

                def write_loop(connection=sock, done=writer_stop):
                    heartbeat = time.monotonic()
                    try:
                        while not done.is_set() and not self.stop.is_set():
                            try:
                                midi = self.outgoing.get(timeout=0.2)
                                if done.is_set():
                                    break
                                send(connection, 1, midi)
                            except queue.Empty:
                                if time.monotonic() - heartbeat >= 5:
                                    send(connection, 3, [4])
                                    heartbeat = time.monotonic()
                    except OSError:
                        try:
                            connection.shutdown(socket.SHUT_RDWR)
                        except OSError:
                            pass

                writer = threading.Thread(target=write_loop, daemon=True)
                writer.start()
                while not self.stop.is_set():
                    kind, data = receive(sock)
                    if kind == 1:
                        self.midi_out.send_message(list(data))
                    elif kind == 2 and self.audio:
                        self.buffer.put(data)
                    elif kind == 6:
                        print(f"{self.name}: {data.decode()}", file=sys.stderr)
            except (OSError, ValueError, RuntimeError) as error:
                if not self.stop.is_set():
                    print(f"{self.name}: {error}; reconnecting", file=sys.stderr, flush=True)
            finally:
                writer_stop.set()
                self.connected.clear()
                self.buffer.clear()
                if self.sock:
                    try:
                        self.sock.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    self.sock.close()
                    self.sock = None
                if 'writer' in locals():
                    writer.join(timeout=1)
            self.stop.wait(1)

    def close(self):
        self.stop.set()
        self.connected.clear()
        if self.sock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.thread.join(timeout=2)
        self.midi_in.close_port()
        self.midi_out.close_port()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dx7", default="127.0.0.1:7007")
    parser.add_argument("--ys200", default="127.0.0.1:7200")
    parser.add_argument("--no-audio", action="store_true")
    parser.add_argument("--audio-device", help="PortAudio device name or index")
    parser.add_argument("--list-audio", action="store_true")
    args = parser.parse_args()
    import rtmidi
    if not args.no_audio or args.list_audio:
        import sounddevice
    if args.list_audio:
        print(sounddevice.query_devices())
        return
    endpoints = []
    stream = None
    try:
        for name, address in [("DX7", args.dx7), ("YS200", args.ys200)]:
            if address != "off":
                endpoints.append(Endpoint(name, address, rtmidi, not args.no_audio))
        if not args.no_audio:
            def callback(outdata, frames, _time, _status):
                mixed = [0.] * (frames * 2)
                for endpoint in endpoints:
                    for i, value in enumerate(endpoint.buffer.take(frames * 2)):
                        mixed[i] += value
                samples = array.array("f", (max(-1., min(1., x)) for x in mixed))
                outdata[:] = samples.tobytes()
            device = args.audio_device
            if device and device.isdigit():
                device = int(device)
            stream = sounddevice.RawOutputStream(samplerate=48000, blocksize=480, channels=2, dtype="float32", latency="low", device=device, callback=callback)
            stream.start()
        while True:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        if stream:
            stream.stop()
            stream.close()
        for endpoint in endpoints:
            endpoint.close()


if __name__ == "__main__":
    main()
