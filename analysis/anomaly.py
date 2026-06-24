import numpy as np
from sklearn.ensemble import IsolationForest
from typing import Any


def extract_features(requests: list[dict]) -> np.ndarray:
    features = []
    for req in requests:
        payload = req.get("payload", req)
        timing = req.get("timing", payload.get("timing", {})) or {}
        response_time = sum(
            timing.get(k, 0) for k in ["receiveHeadersEnd", "sendEnd", "connectEnd", "requestTime"]
        ) or 0

        status = payload.get("status", req.get("status", 200))
        body_size = payload.get("transferSize", req.get("transferSize", 0))
        url = payload.get("url", req.get("url", ""))
        is_third_party = 1 if any(
            d in url for d in [
                "google-analytics.com", "doubleclick.net", "facebook.net",
                "cloudflare.com", "cdn.", "analytics",
            ]
        ) else 0

        features.append([
            response_time / 1000,
            body_size / 1024,
            status if status else 200,
            is_third_party,
            0,
        ])

    if not features:
        return np.zeros((0, 5))

    return np.array(features)


def detect_anomalies(requests: list[dict], contamination: float = 0.05) -> dict[str, Any]:
    X = extract_features(requests)
    if X.shape[0] < 10:
        return [{"warning": "Not enough data for anomaly detection (need >= 10 requests)"}]

    model = IsolationForest(contamination=contamination, random_state=42, n_estimators=100)
    labels = model.fit_predict(X)

    anomalies = []
    for i, (req, label) in enumerate(zip(requests, labels)):
        if label == -1:
            url = req.get("url") or req.get("payload", {}).get("url", "unknown")
            anomalies.append({
                "index": i,
                "url": url,
                "score": round(float(model.score_samples([[X[i]]])[0]), 4),
                "features": {
                    "response_time_ms": round(float(X[i][0]), 2),
                    "body_size_kb": round(float(X[i][1]), 2),
                    "status": int(X[i][2]),
                    "is_third_party": bool(X[i][3]),
                },
            })

    return {
        "total_requests": len(requests),
        "anomalies_found": len(anomalies),
        "contamination": contamination,
        "anomalies": anomalies,
        "normal_count": len(requests) - len(anomalies),
    }
