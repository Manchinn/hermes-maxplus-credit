"""Offline unit tests for maxplus_core. Run: python -m unittest discover -s tests -v"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import maxplus_core as core  # noqa: E402

CCSK = "ccsk-" + "a1" * 32
CCMK = "ccmk-abcdef123456"


def me_payload(limit=None, used=None, active=True, free=None):
    return {
        "credit_usd": 1.0,
        "key": {"pool": "claude", "limit_usd": limit, "limit_used_usd": used, "active": active},
        "daily_free_credit": free or {},
    }


class CoreTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        patcher = mock.patch.object(core, "CONFIG_PATH", Path(self._tmp.name) / "config.json")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(self._tmp.cleanup)
        core.invalidate_cache()
        self.addCleanup(core.invalidate_cache)


class TestConfig(CoreTestCase):
    def test_defaults_when_missing(self):
        cfg = core.load_config()
        self.assertEqual((cfg["ccsk"], cfg["ccmk"]), ("", ""))
        self.assertEqual(cfg["alertThresholdUsd"], core.DEFAULT_ALERT_USD)

    def test_corrupt_file_falls_back_to_defaults(self):
        core.CONFIG_PATH.write_text("{not json", "utf-8")
        self.assertEqual(core.load_config()["ccsk"], "")

    def test_set_tokens_persists_and_public_config_masks(self):
        out = core.set_tokens(CCSK, CCMK)
        self.assertTrue(out["hasCcsk"] and out["hasCcmk"])
        self.assertNotIn(CCSK, json.dumps(out))
        self.assertNotIn(CCMK, json.dumps(out))
        self.assertEqual(core.load_config()["ccsk"], CCSK)

    def test_none_keeps_and_empty_clears(self):
        core.set_tokens(CCSK, CCMK)
        core.set_tokens(None, "")
        cfg = core.load_config()
        self.assertEqual(cfg["ccsk"], CCSK)
        self.assertEqual(cfg["ccmk"], "")

    def test_bad_token_format_rejected_and_nothing_written(self):
        with self.assertRaises(ValueError):
            core.set_tokens("ccsk-short")
        with self.assertRaises(ValueError):
            core.set_tokens(None, "ccmk-123")
        self.assertFalse(core.CONFIG_PATH.exists())

    def test_set_tokens_invalidates_cache(self):
        core.set_tokens(CCSK)
        with mock.patch.object(core, "_request", return_value={"n": 1}) as req:
            core.get_me()
            core.get_me()
            self.assertEqual(req.call_count, 1)
            core.set_tokens(CCSK)
            core.get_me()
            self.assertEqual(req.call_count, 2)

    def test_threshold_clamped_non_negative(self):
        self.assertEqual(core.set_threshold(-5)["alertThresholdUsd"], 0.0)
        self.assertEqual(core.set_threshold(2.5)["alertThresholdUsd"], 2.5)
        self.assertEqual(core.load_config()["alertThresholdUsd"], 2.5)

    def test_mask_token(self):
        self.assertEqual(core.mask_token(""), "")
        self.assertEqual(core.mask_token("ccsk-12345"), "ccsk-…")
        self.assertEqual(core.mask_token("ccsk-1234567890abcdef"), "ccsk-…cdef")


class TestRequest(CoreTestCase):
    def test_no_token_raises_without_network(self):
        with mock.patch("urllib.request.urlopen") as uo:
            with self.assertRaises(core.MaxPlusError) as cm:
                core._request("", "https://x")
            self.assertEqual(str(cm.exception), "no-token")
            uo.assert_not_called()

    def test_http_error_maps_to_key(self):
        import urllib.error

        err = urllib.error.HTTPError("https://x", 401, "no", {}, None)
        with mock.patch("urllib.request.urlopen", side_effect=err):
            with self.assertRaises(core.MaxPlusError) as cm:
                core._request("t", "https://x")
        self.assertEqual(str(cm.exception), "http-401")

    def test_network_failure_maps_to_network(self):
        with mock.patch("urllib.request.urlopen", side_effect=OSError("boom")):
            with self.assertRaises(core.MaxPlusError) as cm:
                core._request("t", "https://x")
        self.assertEqual(str(cm.exception), "network")

    def test_sends_bearer_header(self):
        res = mock.MagicMock()
        res.__enter__.return_value.read.return_value = b'{"ok": true}'
        with mock.patch("urllib.request.urlopen", return_value=res) as uo:
            self.assertEqual(core._request("tok", "https://x"), {"ok": True})
        self.assertEqual(uo.call_args[0][0].get_header("Authorization"), "Bearer tok")


class TestCache(CoreTestCase):
    def test_ttl_and_fresh(self):
        calls = []
        fetch = lambda: calls.append(1) or {"v": len(calls)}  # noqa: E731
        core._cached("k", "tok", "", fetch)
        core._cached("k", "tok", "", fetch)
        self.assertEqual(len(calls), 1)
        core._cached("k", "tok", "", fetch, fresh=True)
        self.assertEqual(len(calls), 2)

    def test_expired_entry_refetches(self):
        calls = []
        fetch = lambda: calls.append(1) or {}  # noqa: E731
        with mock.patch.object(core.time, "monotonic", return_value=1000.0):
            core._cached("k", "tok", "", fetch)
        with mock.patch.object(core.time, "monotonic", return_value=1000.0 + core.CACHE_TTL_S + 1):
            core._cached("k", "tok", "", fetch)
        self.assertEqual(len(calls), 2)

    def test_keyed_per_token_and_never_stores_raw_token(self):
        calls = []
        fetch = lambda: calls.append(1) or {}  # noqa: E731
        core._cached("k", "tok-a", "", fetch)
        core._cached("k", "tok-b", "", fetch)
        self.assertEqual(len(calls), 2)
        self.assertNotIn("tok-a", repr(list(core._cache)))


class TestApiClient(CoreTestCase):
    def test_usage_period_alias_and_validation(self):
        with mock.patch.object(core, "_request", return_value={}) as req:
            core.get_usage("t", "24h")
            self.assertTrue(req.call_args[0][1].endswith("/v1/usage?period=1d"))
        with self.assertRaises(ValueError):
            core.get_usage("t", "1y")

    def test_key_usage_url_is_quoted(self):
        with mock.patch.object(core, "_request", return_value={}) as req:
            core.get_key_usage("a/b c", "mgmt")
        self.assertIn("/v1/api-keys/a%2Fb%20c/usage", req.call_args[0][1])

    def test_pool_base(self):
        self.assertEqual(core.pool_base("native"), f"{core.API_BASE}/v1")
        self.assertEqual(core.pool_base("claude"), f"{core.API_BASE}/claude/v1")
        self.assertEqual(core.pool_base(None), f"{core.API_BASE}/auto/v1")
        for bad in ("../x", "a/b", "A B", "x" * 40):
            with self.assertRaises(ValueError):
                core.pool_base(bad)

    def test_test_key_ok_and_failure(self):
        with mock.patch.object(core, "_request", return_value={}) as req:
            out = core.test_key(CCSK, "claude")
        self.assertTrue(out["ok"])
        self.assertTrue(req.call_args[0][1].endswith("/claude/v1/models"))
        with mock.patch.object(core, "_request", side_effect=core.MaxPlusError("http-403")):
            out = core.test_key(CCSK, "claude")
        self.assertEqual((out["ok"], out["error"]), (False, "http-403"))


class TestShaping(CoreTestCase):
    def test_pick_key_defaults_and_non_numeric(self):
        k = core.pick_key({})
        self.assertEqual(k["pool"], "auto")
        self.assertIsNone(k["limit"])
        k = core.pick_key({"key": {"limit_usd": True, "limit_used_usd": "9"}})
        self.assertIsNone(k["limit"])
        self.assertIsNone(k["used"])

    def test_pick_key_list_shapes(self):
        self.assertEqual(core.pick_key_list({"data": {"keys": [{"id": 1}, "x"]}}), [{"id": 1}])
        self.assertEqual(core.pick_key_list({"data": [{"id": 2}]}), [{"id": 2}])
        self.assertEqual(core.pick_key_list(None), [])

    def test_usage_cost_field_fallbacks(self):
        self.assertEqual(core.usage_cost({"totals": {"total_cost_usd": 1.5}}), 1.5)
        self.assertEqual(core.usage_cost({"cost_usd": 2}), 2)
        self.assertIsNone(core.usage_cost({"totals": {}}))

    def test_remaining_prefers_cap_headroom_then_free_credit(self):
        capped = core.pick_key(me_payload(limit=10, used=9.5))
        self.assertAlmostEqual(core.remaining_usd(capped), 0.5)
        over = core.pick_key(me_payload(limit=10, used=12))
        self.assertEqual(core.remaining_usd(over), 0.0)
        free = core.pick_key(
            me_payload(free={"eligible_for_key_pool": True, "remaining_usd": 3.0, "remaining_for_key_pool_usd": 1.25})
        )
        self.assertEqual(core.remaining_usd(free), 1.25)
        self.assertIsNone(core.remaining_usd(core.pick_key(me_payload())))

    def test_burn_rate(self):
        self.assertEqual(core.burn_rate(2.4, "1d", 0.5), {"period": "1d", "spentUsd": 2.4, "perHourUsd": 0.1, "hoursLeft": 5.0})
        self.assertEqual(core.burn_rate(168, "7d", 10)["perHourUsd"], 1.0)
        self.assertIsNone(core.burn_rate(None, "1d", 1)["perHourUsd"])
        self.assertIsNone(core.burn_rate(0, "1d", 1)["hoursLeft"])
        self.assertIsNone(core.burn_rate(1, "1d", None)["hoursLeft"])


class TestHealth(CoreTestCase):
    def test_no_token_is_error(self):
        h = core.health()
        self.assertEqual((h["health"], h["reason"]), ("error", "no-token"))

    def test_upstream_error_is_surfaced(self):
        core.set_tokens(CCSK)
        with mock.patch.object(core, "_request", side_effect=core.MaxPlusError("http-401")):
            h = core.health()
        self.assertEqual((h["health"], h["reason"]), ("error", "http-401"))

    def test_inactive_key_is_error(self):
        core.set_tokens(CCSK)
        with mock.patch.object(core, "_request", return_value=me_payload(limit=10, used=1, active=False)):
            self.assertEqual(core.health()["reason"], "key-inactive")

    def test_low_balance_warns_and_threshold_is_respected(self):
        core.set_tokens(CCSK)
        payload = me_payload(limit=10, used=9.5)
        with mock.patch.object(core, "_request", return_value=payload):
            h = core.health()
            self.assertEqual((h["health"], h["reason"], h["remainingUsd"]), ("warning", "low-balance", 0.5))
            core.set_threshold(0.25)
            self.assertEqual(core.health(fresh=True)["health"], "ok")

    def test_balance_survives_usage_failure(self):
        core.set_tokens(CCSK)

        def fake(token, url, **_):
            if "/v1/usage" in url:
                raise core.MaxPlusError("http-500")
            return me_payload(limit=10, used=4)

        with mock.patch.object(core, "_request", side_effect=fake):
            b = core.balance()
        self.assertTrue(b["ok"])
        self.assertEqual(b["remainingUsd"], 6)
        self.assertIsNone(b["burn"]["perHourUsd"])

    def test_balance_burn_uses_one_day_usage(self):
        core.set_tokens(CCSK)

        def fake(token, url, **_):
            if "/v1/usage" in url:
                return {"totals": {"total_cost_usd": 2.4}}
            return me_payload(limit=10, used=9.5)

        with mock.patch.object(core, "_request", side_effect=fake):
            burn = core.balance()["burn"]
        self.assertEqual((burn["perHourUsd"], burn["hoursLeft"]), (0.1, 5.0))


class TestToolHandler(CoreTestCase):
    def setUp(self):
        super().setUp()
        import maxplus_tools

        self.tools = maxplus_tools

    def test_unknown_action(self):
        out = json.loads(self.tools.maxplus({"action": "nope"}))
        self.assertFalse(out["ok"])

    def test_errors_become_json_not_exceptions(self):
        out = json.loads(self.tools.maxplus({"action": "balance"}))
        self.assertEqual((out["ok"], out["error"]), (False, "no-token"))
        out = json.loads(self.tools.maxplus({"action": "usage", "period": "1y"}))
        self.assertFalse(out["ok"])

    def test_status_never_leaks_full_tokens(self):
        core.set_tokens(CCSK, CCMK)
        with mock.patch.object(core, "_request", return_value=me_payload(limit=10, used=1)):
            raw = self.tools.maxplus({"action": "status"})
        self.assertNotIn(CCSK, raw)
        self.assertNotIn(CCMK, raw)
        self.assertEqual(json.loads(raw)["health"], "ok")


if __name__ == "__main__":
    unittest.main()
