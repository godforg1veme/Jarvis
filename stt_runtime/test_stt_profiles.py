import unittest

from stt_runtime.stt_profiles import resolve_performance_profile


class SttProfileTests(unittest.TestCase):
    def test_named_profiles_override_direct_values(self):
        self.assertEqual(
            resolve_performance_profile({
                "performanceProfile": "quality",
                "beamSize": 1,
                "vadFilter": False,
            }),
            ("quality", 5, True),
        )
        self.assertEqual(
            resolve_performance_profile({
                "performanceProfile": "efficient",
                "beamSize": 5,
                "vadFilter": True,
            }),
            ("efficient", 1, False),
        )

    def test_custom_profile_and_validation(self):
        self.assertEqual(
            resolve_performance_profile({
                "performanceProfile": "custom",
                "beamSize": 2,
                "vadFilter": False,
            }),
            ("custom", 2, False),
        )
        with self.assertRaisesRegex(ValueError, "Unknown"):
            resolve_performance_profile({"performanceProfile": "fastest"})
        with self.assertRaisesRegex(ValueError, "beamSize"):
            resolve_performance_profile({
                "performanceProfile": "custom",
                "beamSize": 0,
                "vadFilter": True,
            })
        with self.assertRaisesRegex(ValueError, "beamSize"):
            resolve_performance_profile({
                "performanceProfile": "custom",
                "beamSize": 1.5,
                "vadFilter": True,
            })
        with self.assertRaisesRegex(ValueError, "vadFilter"):
            resolve_performance_profile({
                "performanceProfile": "custom",
                "beamSize": 2,
                "vadFilter": "yes",
            })


if __name__ == "__main__":
    unittest.main()
