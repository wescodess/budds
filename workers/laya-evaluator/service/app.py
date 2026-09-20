"""Private, offline Laya HTTP service. It deliberately never logs request bodies."""
from __future__ import annotations

import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Lock
from typing import Any, Protocol

MODEL_REVISION = "f9ab0b228f0fc0f14d873dbc99038f135c2da1b2"
MODEL_PATH = os.environ.get("LAYA_MODEL_PATH", "/opt/laya-model")
MAX_BATCH = 20
MAX_SEMANTIC_BATCH = 8
MAX_BODY_BYTES = 32_000
FREE_RESPONSE_KIND = "quiz.free_response_assessment.v1"
SEMANTIC_LABELS = ("fully_correct", "partially_correct", "incorrect", "uncertain")
SEMANTIC_RUBRIC = (
    ("fully_correct", "The response answers the question completely and is supported by the evidence."),
    ("partially_correct", "The response contains a supported correct idea but is materially incomplete or has a minor error."),
    ("incorrect", "The response is contradicted by the evidence, unsupported, or misses the requested concept."),
    ("uncertain", "The evidence or response is insufficient to make a reliable assessment."),
)


class Backend(Protocol):
    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]: ...


class FakeBackend:
    """Deterministic CI backend; it never represents model behavior."""
    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        label = "supported" if kind == "quiz_quality" else "uncertain"
        labels = ("supported", "needs_review") if kind == "quiz_quality" else SEMANTIC_LABELS
        probabilities = {candidate: 1.0 if candidate == label else 0.0 for candidate in labels}
        return [{"id": item["id"], "label": label, "confidence": 1.0, "probabilities": probabilities} for item in items]


def build_laya_inputs(kind: str, items: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    if kind == FREE_RESPONSE_KIND:
        state = {item["id"]: {
            "question": item["question"], "questionType": item["questionType"],
            "expectedAnswer": item["expectedAnswer"], "learnerAnswer": item["learnerAnswer"],
            "evidenceExcerpt": item["evidenceExcerpt"], "rubricVersion": item["rubricVersion"],
        } for item in items}
        questions = {item["id"]: {
            "type": "choice",
            "instructions": f"Assess only the learner answer stored at state key '{item['id']}' against its question, expected answer, and evidence. Select uncertain whenever the evidence is insufficient.",
            "criteria": {entry["label"]: entry["description"] for entry in item["rubric"]},
        } for item in items}
        return state, questions
    state = {item["id"]: {"question": item["question"], "options": item.get("options", []), "correctAnswer": item["correctAnswer"]} for item in items}
    questions = {
        item["id"]: {
            "type": "choice",
            "instructions": f"Evaluate only the quiz item stored at state key '{item['id']}'. Is its stated correct answer supported by that item?",
            "criteria": {"supported": "answer is supported", "needs_review": "answer needs review"},
        }
        for item in items
    }
    return state, questions


class LayaBackend:
    def __init__(self) -> None:
        import laya  # Imported only in the production image.
        self.agent = laya.load(MODEL_PATH)

    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # This is intentionally the sole mapping from our canonical task to Laya.
        state, questions = build_laya_inputs(kind, items)
        result = self.agent.predict(state, questions)
        answers = result["answers"]
        decisions = []
        for item in items:
            answer = answers[item["id"]]
            label = answer.get("choice", "needs_review")
            confidence = float(answer.get("confidence", 0))
            allowed = ("supported", "needs_review") if kind == "quiz_quality" else SEMANTIC_LABELS
            fallback = "needs_review" if kind == "quiz_quality" else "uncertain"
            selected = label if label in allowed else fallback
            raw_probabilities = answer.get("probabilities", {})
            probabilities = {candidate: min(1, max(0, float(raw_probabilities.get(candidate, 0)))) for candidate in allowed}
            total = sum(probabilities.values())
            decision = {"id": item["id"], "label": selected, "confidence": min(1, max(0, confidence))}
            if total > 0:
                normalized = {candidate: probability / total for candidate, probability in probabilities.items()}
                if normalized[selected] >= max(normalized.values()): decision["probabilities"] = normalized
            decisions.append(decision)
        return decisions


def valid_request(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"kind", "requestId", "inputDigest", "items"} or value.get("kind") not in ("quiz_quality", FREE_RESPONSE_KIND): return False
    if not isinstance(value.get("requestId"), str) or not 0 < len(value["requestId"]) <= 128: return False
    if not isinstance(value.get("inputDigest"), str) or re.fullmatch(r"[a-f0-9]{64}", value["inputDigest"]) is None: return False
    items = value.get("items")
    limit = MAX_BATCH if value["kind"] == "quiz_quality" else MAX_SEMANTIC_BATCH
    if not isinstance(items, list) or not 0 < len(items) <= limit: return False
    if len({item.get("id") for item in items if isinstance(item, dict)}) != len(items): return False
    for item in items:
        if value["kind"] == "quiz_quality":
            if not isinstance(item, dict) or not set(item).issubset({"id", "question", "correctAnswer", "options"}): return False
            if not all(isinstance(item.get(key), str) and 0 < len(item[key]) <= size for key, size in (("id", 64), ("question", 1200), ("correctAnswer", 400))): return False
            options = item.get("options", [])
            if not isinstance(options, list) or len(options) > 8 or any(not isinstance(option, str) or not 0 < len(option) <= 400 for option in options): return False
        else:
            if not isinstance(item, dict) or set(item) != {"id", "question", "questionType", "expectedAnswer", "learnerAnswer", "evidenceExcerpt", "rubricVersion", "rubric"}: return False
            if item.get("questionType") not in ("free-response", "fill_in_the_blank") or item.get("rubricVersion") != FREE_RESPONSE_KIND: return False
            if not all(isinstance(item.get(key), str) and 0 < len(item[key]) <= size for key, size in (("id", 64), ("question", 1200), ("expectedAnswer", 400), ("learnerAnswer", 800), ("evidenceExcerpt", 1200))): return False
            rubric = item.get("rubric")
            if not isinstance(rubric, list) or len(rubric) != len(SEMANTIC_LABELS): return False
            if any(not isinstance(entry, dict) or set(entry) != {"label", "description"} or (entry.get("label"), entry.get("description")) != SEMANTIC_RUBRIC[index] for index, entry in enumerate(rubric)): return False
    return True


def create_app(backend: Backend | None):
    inference_lock = Lock()
    state = {"backend": backend, "ready": backend is not None}
    def set_backend(value: Backend | None): state.update(backend=value, ready=value is not None)
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: Any) -> None: pass
        def send_json(self, status: int, payload: dict[str, Any]) -> None:
            raw = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw))); self.end_headers(); self.wfile.write(raw)
        def do_GET(self) -> None:
            if self.path == "/health/live": self.send_json(200, {"live": True})
            elif self.path == "/health/ready": self.send_json(200 if state["ready"] else 503, {"ready": state["ready"], "modelRevision": MODEL_REVISION})
            else: self.send_json(404, {"error": "Not found"})
        def do_POST(self) -> None:
            if self.path != "/v1/evaluate": self.send_json(404, {"error": "Not found"}); return
            length = self.headers.get("Content-Length", "")
            try: size = int(length)
            except ValueError: self.send_json(413, {"error": "Request rejected"}); return
            if size < 1 or size > MAX_BODY_BYTES: self.send_json(413, {"error": "Request rejected"}); return
            try: body = json.loads(self.rfile.read(size))
            except (UnicodeDecodeError, json.JSONDecodeError): self.send_json(422, {"error": "Request rejected"}); return
            if not valid_request(body): self.send_json(422, {"error": "Request rejected"}); return
            if not state["ready"]: self.send_json(503, {"error": "Unavailable"}); return
            try:
                with inference_lock: decisions = state["backend"].evaluate(body["kind"], body["items"])
                if not isinstance(decisions, list) or {item.get("id") for item in decisions if isinstance(item, dict)} != {item["id"] for item in body["items"]} or len(decisions) != len(body["items"]): raise ValueError("invalid backend result")
                self.send_json(200, {"status": "completed", "provider": "laya", "modelRevision": MODEL_REVISION, "decisions": decisions})
            except Exception:
                # Never include model/provider content in the response or logs.
                self.send_json(503, {"error": "Unavailable"})
    return Handler, set_backend


def main() -> None:
    initial: Backend | None = FakeBackend() if os.environ.get("LAYA_FAKE_BACKEND") == "1" else None
    handler, set_backend = create_app(initial)
    server = ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), handler)
    if initial is None:
        def load():
            try: set_backend(LayaBackend())
            except Exception: set_backend(None)
        threading.Thread(target=load, daemon=True).start()
    server.serve_forever()

if __name__ == "__main__": main()
