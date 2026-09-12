"""Public-output tests for paired live receive proof; no Viber access."""

import unittest

from verify_p1_paired_receive_live import failure, summarize


class PairedReceiveLiveTests(unittest.TestCase):
    def test_summary_never_exports_text_or_ids(self):
        private = "synthetic-private-value"
        result = summarize([{"source_event_id": 12, "text": private},
                            {"source_event_id": 13, "text": private}])
        self.assertEqual(result["inbound_occurrences_after_anchor"], 2)
        self.assertTrue(result["identical_text_occurrences_preserved"])
        self.assertNotIn(private, repr(result))
        self.assertNotIn("source_event_id", result)

    def test_explicit_reveal_returns_only_latest_inbound_text(self):
        result = summarize([{"source_event_id": 12, "text": "first"},
                            {"source_event_id": 13, "text": "latest"}], reveal_latest=True,
                           latest_text="latest")
        self.assertEqual(result["latest_inbound_text"], "latest")

    def test_failure_codes_are_fixed(self):
        self.assertEqual(failure("private detail")["error_code"], "PAIRED_READ_FAILED")
        self.assertFalse(failure("SOURCE_CHANGED")["anchor_verified"])


if __name__ == "__main__":
    unittest.main()
