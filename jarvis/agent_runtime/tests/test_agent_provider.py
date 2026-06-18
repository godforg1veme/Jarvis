import json
import os
import tempfile
import unittest
from pathlib import Path

from agent_runtime.llm.agent_provider import (
    AgentLlmUnavailable,
    agent_ai_settings,
    build_gemini_chat_model,
    get_gemini_api_key,
    parse_json_object,
)


class AgentProviderTests(unittest.TestCase):
    def test_key_lookup_order(self):
        self.assertEqual(get_gemini_api_key({"GOOGLE_API_KEY": "google"}), "google")
        self.assertEqual(get_gemini_api_key({"GEMINI_API_KEY": "gemini", "GOOGLE_API_KEY": "google"}), "gemini")

    def test_parse_json_object_from_markdown(self):
        self.assertEqual(parse_json_object("```json\n{\"steps\": []}\n```"), {"steps": []})

    def test_settings_defaults_and_override(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "data").mkdir()
            (root / "data" / "ai-settings.json").write_text(
                json.dumps({"agentAi": {"provider": "gemini", "model": "test-model"}}),
                encoding="utf-8",
            )
            settings = agent_ai_settings(root)
            self.assertEqual(settings["provider"], "gemini")
            self.assertEqual(settings["model"], "test-model")

    def test_missing_key_is_clear(self):
        with self.assertRaises(AgentLlmUnavailable):
            build_gemini_chat_model(
                {"model": "test", "timeoutMs": 1000, "maxRetries": 0},
                env={},
            )


if __name__ == "__main__":
    unittest.main()
