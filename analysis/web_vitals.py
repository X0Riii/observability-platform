from typing import Any


def analyze_web_vitals(events: list[dict]) -> dict[str, Any]:
    vitals: dict[str, list[float]] = {}

    for ev in events:
        payload = ev.get("payload", {})
        perf_type = payload.get("type") or ev.get("type", "")

        if perf_type.startswith("perf:"):
            metric = perf_type.replace("perf:", "")
            value = payload.get("value") or payload.get("data", {}).get("value")
            if value is not None:
                vitals.setdefault(metric, []).append(float(value))

        if ev.get("type") == "performance":
            metrics = payload.get("metrics", {})
            for key, value in metrics.items():
                if isinstance(value, (int, float)):
                    vitals.setdefault(key, []).append(float(value))

    result = {}
    for metric, values in vitals.items():
        result[metric] = {
            "values": values,
            "min": round(min(values), 2),
            "max": round(max(values), 2),
            "avg": round(sum(values) / len(values), 2),
            "p50": round(sorted(values)[len(values) // 2], 2),
            "p95": round(sorted(values)[int(len(values) * 0.95)], 2),
            "count": len(values),
        }

        threshold = _get_threshold(metric)
        if threshold:
            result[metric]["pass"] = result[metric]["p95"] <= threshold
            result[metric]["threshold"] = threshold

    return result


def _get_threshold(metric: str) -> float | None:
    thresholds = {
        "LCP": 2500,
        "lcp": 2500,
        "largest-contentful-paint": 2500,
        "FCP": 1800,
        "fcp": 1800,
        "first-contentful-paint": 1800,
        "CLS": 0.1,
        "cls": 0.1,
        "cumulative-layout-shift": 0.1,
        "INP": 200,
        "inp": 200,
        "interaction-to-next-paint": 200,
        "TTFB": 800,
        "ttfb": 800,
        "time-to-first-byte": 800,
        "FID": 100,
        "fid": 100,
        "first-input-delay": 100,
    }
    return thresholds.get(metric)
