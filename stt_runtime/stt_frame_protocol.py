import json
import struct


MAGIC = b"JSTT"
VERSION = 1
HEADER = struct.Struct("<4sBBI")
MAX_PAYLOAD_BYTES = 1024 * 1024
FRAME_TYPE_PCM = 1
FRAME_TYPE_CONTROL = 2
VALID_FRAME_TYPES = {FRAME_TYPE_PCM, FRAME_TYPE_CONTROL}


class SttFrameProtocolError(ValueError):
    pass


def read_exact(stream, size):
    chunks = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            if remaining == size:
                return None
            received = size - remaining
            raise SttFrameProtocolError(
                f"Truncated STT frame: expected {size} bytes, received {received}."
            )
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_frames(stream):
    while True:
        header = read_exact(stream, HEADER.size)
        if header is None:
            return

        magic, version, frame_type, payload_length = HEADER.unpack(header)
        if magic != MAGIC:
            raise SttFrameProtocolError("Invalid STT frame magic.")
        if version != VERSION:
            raise SttFrameProtocolError(f"Unsupported STT frame version: {version}.")
        if frame_type not in VALID_FRAME_TYPES:
            raise SttFrameProtocolError(f"Unsupported STT frame type: {frame_type}.")
        if payload_length > MAX_PAYLOAD_BYTES:
            raise SttFrameProtocolError(
                f"STT frame payload is too large: {payload_length} bytes "
                f"(maximum {MAX_PAYLOAD_BYTES})."
            )

        payload = read_exact(stream, payload_length)
        if payload is None:
            raise SttFrameProtocolError("Truncated STT frame payload.")
        if frame_type == FRAME_TYPE_PCM and (not payload or len(payload) % 2 != 0):
            raise SttFrameProtocolError(
                "PCM payload must contain a non-empty, even number of PCM16 bytes."
            )
        yield frame_type, payload


def decode_control(payload):
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SttFrameProtocolError(f"Invalid STT control JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SttFrameProtocolError("STT control JSON must decode to an object.")
    return value
