"""Framed TCP transport shared by the host bridge and CLI; Python stdlib only."""
import socket
import struct


def exact(sock, length):
    result = bytearray()
    while len(result) < length:
        chunk = sock.recv(length - len(result))
        if not chunk:
            raise ConnectionError("instrument disconnected")
        result.extend(chunk)
    return bytes(result)


def receive(sock):
    length, = struct.unpack("!I", exact(sock, 4))
    if not 1 <= length <= 65536:
        raise ValueError("invalid instrument packet length")
    data = exact(sock, length)
    return data[0], data[1:]


def send(sock, kind, data=b""):
    if len(data) >= 65536:
        raise ValueError("packet too large")
    sock.sendall(struct.pack("!IB", len(data) + 1, kind) + bytes(data))


def connect(address):
    host, port = address.rsplit(":", 1)
    sock = socket.create_connection((host, int(port)), timeout=5)
    sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
    kind, status = receive(sock)
    if kind != 5:
        sock.close()
        raise ConnectionError("invalid instrument greeting")
    return sock, status
