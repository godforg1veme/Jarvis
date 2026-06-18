import json
import unittest

from agent_runtime.client_protocol import ProtocolError, encode_event, make_event, parse_message
from agent_runtime.graphs.desktop_graph import run_desktop_task


class ProtocolTests(unittest.TestCase):
    def test_parse_ping(self):
        message = parse_message('{"type":"ping","id":"1"}')
        self.assertEqual(message.message_type, "ping")
        self.assertEqual(message.message_id, "1")
        self.assertEqual(message.payload, {})

    def test_reject_non_object(self):
        with self.assertRaises(ProtocolError):
            parse_message("[]")

    def test_encode_utf8_event(self):
        encoded = encode_event(make_event("event", payload={"message": "Привет"}))
        decoded = json.loads(encoded)
        self.assertEqual(decoded["payload"]["message"], "Привет")

    def test_demo_plan_needs_input(self):
        state = run_desktop_task("Агент, найди все png на рабочем столе и перемести до 20 штук в папку Images")
        self.assertEqual(state["phase"], "needs_input")
        self.assertTrue(any(step["action"] == "ask_user" for step in state["plan"]))


if __name__ == "__main__":
    unittest.main()
