import io
import json
import struct
import unittest

from stt_runtime.stt_frame_protocol import (
    FRAME_TYPE_CONTROL,
    FRAME_TYPE_PCM,
    HEADER,
    MAGIC,
    MAX_PAYLOAD_BYTES,
    VERSION,
    SttFrameProtocolError,
    decode_control,
    read_frames,
)


def frame(frame_type, payload):
    return HEADER.pack(MAGIC, VERSION, frame_type, len(payload)) + payload


class ShortReadBytesIO(io.BytesIO):
    def read(self, size=-1):
        return super().read(1 if size < 0 else min(size, 1))


class SttFrameProtocolTests(unittest.TestCase):
    def test_reads_fragmented_and_multiple_frames(self):
        pcm = b"\x01\x00\x02\x00"
        control = json.dumps({"type": "stop"}).encode("utf-8")
        frames = list(read_frames(ShortReadBytesIO(
            frame(FRAME_TYPE_PCM, pcm) + frame(FRAME_TYPE_CONTROL, control)
        )))
        self.assertEqual(frames[0], (FRAME_TYPE_PCM, pcm))
        self.assertEqual(decode_control(frames[1][1]), {"type": "stop"})

    def test_rejects_invalid_header_and_payload(self):
        with self.assertRaisesRegex(SttFrameProtocolError, "magic"):
            list(read_frames(io.BytesIO(HEADER.pack(b"FAIL", VERSION, FRAME_TYPE_PCM, 2) + b"\0\0")))
        with self.assertRaisesRegex(SttFrameProtocolError, "version"):
            list(read_frames(io.BytesIO(HEADER.pack(MAGIC, 9, FRAME_TYPE_PCM, 2) + b"\0\0")))
        with self.assertRaisesRegex(SttFrameProtocolError, "type"):
            list(read_frames(io.BytesIO(HEADER.pack(MAGIC, VERSION, 9, 0))))
        with self.assertRaisesRegex(SttFrameProtocolError, "too large"):
            list(read_frames(io.BytesIO(
                HEADER.pack(MAGIC, VERSION, FRAME_TYPE_PCM, MAX_PAYLOAD_BYTES + 1)
            )))
        with self.assertRaisesRegex(SttFrameProtocolError, "even number"):
            list(read_frames(io.BytesIO(frame(FRAME_TYPE_PCM, b"\0"))))

    def test_rejects_truncated_frame(self):
        encoded = frame(FRAME_TYPE_PCM, b"\0\0")
        with self.assertRaisesRegex(SttFrameProtocolError, "Truncated"):
            list(read_frames(io.BytesIO(encoded[:-1])))


if __name__ == "__main__":
    unittest.main()
