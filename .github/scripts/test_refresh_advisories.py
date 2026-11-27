from datetime import datetime, timezone
import json
import unittest

from refresh_advisories import baseline, parse_source, refresh

NOW = datetime(2026, 1, 3, 12, tzinfo=timezone.utc)
RSS = b"<rss><channel><item><title>Example update</title><link>https://www.boho.or.kr/kr/bbs/view.do?bbsId=B0000133&amp;nttId=123</link><pubDate>2026-01-03</pubDate></item></channel></rss>"
CAT = json.dumps({"count": 1, "vulnerabilities": [{"cveID": "CVE-2026-9999",
    "vendorProject": "Example", "product": "Sample", "dateAdded": "2026-01-02"}]}).encode()


def good(url, _limit):
    return RSS if "boho.or.kr" in url else CAT


class SourceTests(unittest.TestCase):
    def test_two_publishers_and_dates(self):
        doc = refresh(NOW, {}, good)
        self.assertEqual([row["id"] for row in doc["items"]], ["KISA-123", "CVE-2026-9999"])
        self.assertTrue(all(row["status"] == "ok" for row in doc["sources"]))
        self.assertEqual(doc["items"][0]["publishedAt"], "2026-01-03")
        self.assertNotIn("requiredAction", doc["items"][1])

    def test_bad_sources_and_future_content(self):
        for source, raw in [
            ("kisa", RSS.replace(b"www.boho.or.kr", b"example.org")),
            ("kisa", RSS.replace(b"2026-01-03", b"2027-01-01")),
            ("kisa", b"<rss><channel/></rss>"),
            ("kisa", b'<!DOCTYPE rss [<!ENTITY x "y">]>' + RSS),
            ("cisa-kev", b'{"count":1,"vulnerabilities":[]}'),
            ("cisa-kev", CAT.replace(b"CVE-2026-9999", b"http://example.org")),
        ]:
            with self.subTest(source=source, raw=raw), self.assertRaises(ValueError):
                parse_source(source, raw, NOW)

    def test_outage_retains_original_success_time_and_notices(self):
        doc = refresh(NOW, {}, good)
        previous = baseline(json.dumps(doc), NOW)
        later = datetime(2026, 1, 4, tzinfo=timezone.utc)

        def partial(url, limit):
            if "boho.or.kr" in url:
                raise TimeoutError()
            return good(url, limit)

        updated = refresh(later, previous, partial)
        self.assertNotEqual(updated["checkedAt"], doc["checkedAt"])
        self.assertEqual(updated["sources"][0]["status"], "unavailable")
        self.assertEqual(updated["sources"][0]["lastSuccessAt"], doc["sources"][0]["lastSuccessAt"])
        self.assertEqual(updated["sources"][1]["lastSuccessAt"], updated["checkedAt"])
        self.assertEqual(updated["items"], doc["items"])
        self.assertNotIn("unavailable", str(doc))

    def test_rejects_untrusted_saved_link(self):
        doc = refresh(NOW, {}, good)
        doc["items"][0]["url"] = "https://example.org/"
        with self.assertRaises(ValueError):
            baseline(json.dumps(doc), NOW)

    def test_refuses_inconsistent_dates(self):
        doc = refresh(NOW, {}, good)
        doc["sources"][0]["lastSuccessAt"] = "2030-01-01T00:00:00Z"
        with self.assertRaises(ValueError):
            baseline(json.dumps(doc), NOW)


if __name__ == "__main__":
    unittest.main()
