from typing import Literal

ThirdPartyCategory = Literal["analytics", "ads", "cdn", "tracking", "chat", "social", "utility"]

KNOWN_THIRD_PARTIES: dict[ThirdPartyCategory, list[str]] = {
    "analytics": ["google-analytics.com", "gtag", "segment.io", "mixpanel.com", "amplitude.com", "heap.io"],
    "ads": ["doubleclick.net", "googlesyndication.com", "amazon-adsystem.com", "adservice.google.com"],
    "cdn": ["cloudflare.com", "fastly.net", "akamaihd.net", "jsdelivr.net", "unpkg.com", "cdn.jsdelivr.net"],
    "tracking": ["facebook.net", "twitter.com/i/adsct", "hotjar.com", "fullstory.com", "mouseflow.com"],
    "chat": ["intercom.io", "drift.com", "crisp.chat", "zendesk.com", "livechat.com"],
    "social": ["facebook.com/plugins", "platform.twitter.com", "linkedin.com/embed"],
    "utility": ["recaptcha.net", "hcaptcha.com", "stripe.com", "paypal.com"],
}


def classify_request(url: str) -> ThirdPartyCategory | None:
    for category, patterns in KNOWN_THIRD_PARTIES.items():
        if any(p in url for p in patterns):
            return category
    return None


def analyze_third_parties(requests: list[dict]) -> dict:
    results: dict[str, list[str]] = {}
    for req in requests:
        url = req.get("url") or ""
        category = classify_request(url)
        if category:
            results.setdefault(category, []).append(url)

    return {
        "total_requests": len(requests),
        "third_party_requests": sum(len(v) for v in results.values()),
        "categories": {k: {"count": len(v), "urls": v[:5]} for k, v in results.items()},
        "percentage": round(sum(len(v) for v in results.values()) / max(len(requests), 1) * 100, 1),
    }
