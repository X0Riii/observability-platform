from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Any

from dependency_graph import build_dependency_graph, analyze_dependency_graph
from third_party import analyze_third_parties
from web_vitals import analyze_web_vitals
from anomaly import detect_anomalies
from report import generate_html_report

app = FastAPI(title="OBS Analysis Engine", version="2.0.0")


class AnalysisRequest(BaseModel):
    session_id: str
    requests: list[dict] = []
    dom_events: list[dict] = []
    storage_events: list[dict] = []
    js_events: list[dict] = []
    performance_events: list[dict] = []


@app.get("/health")
async def health():
    return {"status": "ok", "service": "analysis-engine"}


@app.post("/analyze")
async def analyze(req: AnalysisRequest) -> dict[str, Any]:
    try:
        G = build_dependency_graph(req.requests, req.storage_events)
        dependency_result = analyze_dependency_graph(G)

        third_party_result = analyze_third_parties(req.requests)

        vitals_result = analyze_web_vitals(req.performance_events)

        anomalies_result = detect_anomalies(req.requests)

        return {
            "session_id": req.session_id,
            "dependency_graph": dependency_result,
            "third_parties": third_party_result,
            "web_vitals": vitals_result,
            "anomalies": anomalies_result,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ReportRequest(AnalysisRequest):
    pass


@app.post("/report", response_class=HTMLResponse)
async def generate_report(req: ReportRequest):
    G = build_dependency_graph(req.requests, req.storage_events)
    dependency_result = analyze_dependency_graph(G)
    third_party_result = analyze_third_parties(req.requests)
    vitals_result = analyze_web_vitals(req.performance_events)
    anomalies_result = detect_anomalies(req.requests)

    return generate_html_report(
        session_id=req.session_id,
        dependency=dependency_result,
        third_party=third_party_result,
        vitals=vitals_result,
        anomalies=anomalies_result,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
