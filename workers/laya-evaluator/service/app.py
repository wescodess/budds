"""Private, offline Laya HTTP service. It deliberately never logs request bodies."""
from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import re
import threading
from importlib import metadata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from typing import Any, Callable, Protocol

MANIFEST_PATH = Path(os.environ.get("LAYA_EVALUATOR_MANIFEST", Path(__file__).with_name("learningDecisionManifest.json")))
if not MANIFEST_PATH.exists():
    MANIFEST_PATH = Path(__file__).resolve().parents[1] / "learningDecisionManifest.json"
MANIFEST_BYTES = MANIFEST_PATH.read_bytes()
MANIFEST = json.loads(MANIFEST_BYTES)
EVALUATION_MANIFEST_SHA256 = hashlib.sha256(MANIFEST_BYTES).hexdigest()

MODEL_REVISION = MANIFEST["model"]["revision"]
MODEL_PATH = os.environ.get("LAYA_MODEL_PATH", "/opt/laya-model")
CONTRACT_VERSION = MANIFEST["contractVersion"]
SNAPSHOT_VERSION = MANIFEST["snapshotVersion"]
MAX_BATCH = MANIFEST["limits"]["qualityBatchSize"]
MAX_SEMANTIC_BATCH = MANIFEST["limits"]["semanticBatchSize"]
MAX_BODY_BYTES = MANIFEST["limits"]["requestBytes"]
MAX_REQUEST_ID_CHARS = MANIFEST["limits"]["requestIdChars"]
MAX_ITEM_ID_CHARS = MANIFEST["limits"]["itemIdChars"]
MAX_OPTION_COUNT = MANIFEST["limits"]["optionCount"]
FREE_RESPONSE_KIND = MANIFEST["decisionKinds"]["freeResponse"]["kind"]
QUALITY_KIND = MANIFEST["decisionKinds"]["quizQuality"]["kind"]
QUALITY_PRIMITIVE = MANIFEST["decisionKinds"]["quizQuality"]["primitive"]
QUALITY_LABELS = tuple(MANIFEST["decisionKinds"]["quizQuality"]["labels"])
SEMANTIC_LABELS = tuple(MANIFEST["decisionKinds"]["freeResponse"]["labels"])
SEMANTIC_RUBRIC = tuple((entry["label"], entry["description"]) for entry in MANIFEST["decisionKinds"]["freeResponse"]["rubric"])
CALIBRATOR_SCHEMA_VERSION = "budds.laya-semantic-temperature-calibrator.v1"
CALIBRATOR_METHOD = "multiclass_temperature_scaling"
CALIBRATOR_EPSILON = 1e-12
MIN_CALIBRATOR_TEMPERATURE = 0.05
MAX_CALIBRATOR_TEMPERATURE = 10


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def temperature_scale(probabilities: dict[str, float], temperature: float) -> dict[str, float]:
    """Apply multiclass temperature scaling to an already-normalized distribution."""
    weights = {
        label: math.exp(math.log(max(probability, CALIBRATOR_EPSILON)) / temperature)
        for label, probability in probabilities.items()
    }
    total = sum(weights.values())
    return {label: weight / total for label, weight in weights.items()}


def load_calibrator(path: Path, provenance: dict[str, str]) -> tuple[float, str]:
    """Load an exact, provenance-bound calibrator or fail closed."""
    raw = path.read_bytes()
    value = json.loads(raw)
    root_names = {"schemaVersion", "status", "method", "labels", "bounds", "epsilon", "fitCorpus", "pins", "fitResult"}
    if not isinstance(value, dict) or set(value) != root_names:
        raise ValueError("invalid calibrator")
    if value["schemaVersion"] != CALIBRATOR_SCHEMA_VERSION or value["status"] != "fitted" or value["method"] != CALIBRATOR_METHOD:
        raise ValueError("invalid calibrator")
    if value["bounds"] != {"minimumTemperature": MIN_CALIBRATOR_TEMPERATURE, "maximumTemperature": MAX_CALIBRATOR_TEMPERATURE}:
        raise ValueError("invalid calibrator")
    if value["epsilon"] != CALIBRATOR_EPSILON:
        raise ValueError("invalid calibrator")
    if value["labels"] != list(SEMANTIC_LABELS):
        raise ValueError("invalid calibrator")
    fit_corpus = value["fitCorpus"]
    if not isinstance(fit_corpus, dict) or set(fit_corpus) != {"path", "version", "sha256"}:
        raise ValueError("invalid calibrator")
    if not all(isinstance(fit_corpus.get(name), str) and fit_corpus[name] for name in ("path", "version")):
        raise ValueError("invalid calibrator")
    if not isinstance(fit_corpus.get("sha256"), str) or re.fullmatch(r"[a-f0-9]{64}", fit_corpus["sha256"]) is None:
        raise ValueError("invalid calibrator")
    pins = value["pins"]
    pin_names = {"packageVersion", "modelRevision", "modelSha256", "evaluationManifestSha256"}
    if not isinstance(pins, dict) or set(pins) != pin_names or any(not isinstance(pins[name], str) for name in pin_names):
        raise ValueError("invalid calibrator")
    if pins != provenance:
        raise ValueError("invalid calibrator")
    fit_result = value["fitResult"]
    if not isinstance(fit_result, dict) or set(fit_result) != {"temperature", "negativeLogLikelihood", "iterations"}:
        raise ValueError("invalid calibrator")
    temperature = fit_result["temperature"]
    nll = fit_result["negativeLogLikelihood"]
    iterations = fit_result["iterations"]
    if isinstance(temperature, bool) or not isinstance(temperature, (int, float)) or not math.isfinite(temperature) or not MIN_CALIBRATOR_TEMPERATURE <= temperature <= MAX_CALIBRATOR_TEMPERATURE:
        raise ValueError("invalid calibrator")
    if isinstance(nll, bool) or not isinstance(nll, (int, float)) or not math.isfinite(nll) or nll < 0:
        raise ValueError("invalid calibrator")
    if isinstance(iterations, bool) or not isinstance(iterations, int) or iterations < 1:
        raise ValueError("invalid calibrator")
    return float(temperature), hashlib.sha256(raw).hexdigest()


class Backend(Protocol):
    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]: ...


class FakeBackend:
    """Deterministic CI backend; it never represents model behavior."""
    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        labels = QUALITY_LABELS if kind == QUALITY_KIND else SEMANTIC_LABELS
        label = labels[0] if kind == QUALITY_KIND else labels[-1]
        probabilities = {candidate: 1.0 if candidate == label else 0.0 for candidate in labels}
        return [{"id": item["id"], "label": label, "confidence": 1.0, "probabilities": probabilities} for item in items]


def build_laya_input(kind: str, item: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Map one independent decision item to Laya's one-state public API.

    Laya evaluates every question in a call against the same state. Unrelated
    quiz items must therefore be sent as separate predict calls, otherwise an
    item can observe another learner answer and the shared state can truncate.
    """
    if kind == FREE_RESPONSE_KIND:
        state = {
            "question": item["question"], "questionType": item["questionType"],
            "expectedAnswer": item["expectedAnswer"], "learnerAnswer": item["learnerAnswer"],
            "evidenceExcerpt": item["evidenceExcerpt"], "language": item["language"], "rubricVersion": item["rubricVersion"],
        }
        questions = {item["id"]: {
            "type": "choice",
            "instructions": "Grade the learner answer against the expected answer using only the evidence. Count every distinct requested component. Accept equivalent wording and order. Missing evidence is uncertain.",
            "criteria": {entry["label"]: entry["description"] for entry in item["rubric"]},
        }}
        return state, questions
    state = {
        "question": item["question"], "options": item.get("options", []), "correctAnswer": item["correctAnswer"],
        "language": item["language"], "sourceIndex": item["evidence"]["sourceIndex"], "sourceExcerpt": item["evidence"]["excerpt"],
    }
    questions = {
        item["id"]: {
            "type": QUALITY_PRIMITIVE,
            "instructions": "Is the stated answer directly supported by its exact source excerpt?",
        },
    }
    return state, questions


def assert_laya_state_fits(agent: Any, state: dict[str, Any]) -> None:
    """Reject input that Laya would silently truncate after its question head."""
    config = getattr(agent, "cfg", None)
    tokenizer = getattr(agent, "tok", None)
    if not isinstance(config, dict) or not callable(tokenizer):
        raise ValueError("invalid Laya runtime")
    max_len = config.get("max_len", 512)
    head_max_len = config.get("head_max_len", 192)
    if isinstance(max_len, bool) or not isinstance(max_len, int) or isinstance(head_max_len, bool) or not isinstance(head_max_len, int):
        raise ValueError("invalid Laya token budget")
    # build_sequence reserves at most head_max_len tokens for instructions and
    # choices plus four structural tokens. Using the minimum remaining room
    # prevents any state field from being silently discarded.
    state_budget = max_len - head_max_len - 4
    encoded = tokenizer(json.dumps(state, ensure_ascii=False), add_special_tokens=False)
    input_ids = encoded.get("input_ids") if isinstance(encoded, dict) else getattr(encoded, "input_ids", None)
    if state_budget < 1 or not isinstance(input_ids, (list, tuple)) or len(input_ids) > state_budget:
        raise ValueError("Laya state exceeds model token budget")


class LayaBackend:
    def __init__(
        self,
        *,
        model_path: str | Path = MODEL_PATH,
        model_revision: str = MODEL_REVISION,
        package_version_resolver: Callable[[str], str] = metadata.version,
        agent_loader: Callable[[str], Any] | None = None,
        calibrator_path: str | Path | None = None,
        calibration_mode: str | None = None,
    ) -> None:
        resolved_model_path = Path(model_path)
        self.provenance = {
            "packageVersion": package_version_resolver("laya"),
            "modelRevision": model_revision,
            "modelSha256": sha256_file(resolved_model_path / "model.safetensors"),
            "evaluationManifestSha256": EVALUATION_MANIFEST_SHA256,
        }
        self.calibration_mode = calibration_mode if calibration_mode is not None else os.environ.get("LAYA_CALIBRATION_MODE", "")
        if self.calibration_mode not in ("", "fit"):
            raise ValueError("invalid calibration mode")
        configured_calibrator = calibrator_path if calibrator_path is not None else os.environ.get("LAYA_CALIBRATOR_PATH")
        self.calibrator_temperature: float | None = None
        self.calibrator_sha256: str | None = None
        # Raw fitting must never consume an existing calibrator. Normal runtime,
        # by contrast, remains unready unless the exact fitted artifact loads.
        if configured_calibrator and self.calibration_mode != "fit":
            self.calibrator_temperature, self.calibrator_sha256 = load_calibrator(Path(configured_calibrator), self.provenance)
        if agent_loader is None:
            laya = importlib.import_module("laya")  # Imported only in the production image.
            agent_loader = laya.load
        self.agent = agent_loader(str(resolved_model_path))

    def evidence_headers(self) -> dict[str, str]:
        calibrator_status = "valid" if self.calibrator_sha256 else ("raw-fit" if self.calibration_mode == "fit" else "absent")
        headers = {
            "X-Laya-Evidence-Backend": "real",
            "X-Laya-Package-Version": self.provenance["packageVersion"],
            "X-Laya-Model-Revision": self.provenance["modelRevision"],
            "X-Laya-Model-SHA256": self.provenance["modelSha256"],
            "X-Laya-Evaluation-Manifest-SHA256": self.provenance["evaluationManifestSha256"],
            "X-Laya-Calibrator-Status": calibrator_status,
        }
        if self.calibration_mode == "fit" and not self.calibrator_sha256:
            headers["X-Laya-Calibration-Mode"] = "fit"
        if self.calibrator_sha256:
            headers["X-Laya-Calibrator-SHA256"] = self.calibrator_sha256
        return headers

    def evaluate(self, kind: str, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        # This is intentionally the sole mapping from our canonical task to Laya.
        decisions = []
        for item in items:
            state, questions = build_laya_input(kind, item)
            assert_laya_state_fits(self.agent, state)
            result = self.agent.predict(state, questions)
            answers = result["answers"]
            answer = answers[item["id"]]
            confidence = float(answer.get("confidence", 0))
            if kind == QUALITY_KIND:
                support_probability = min(1, max(0, float(answer.get("probability", answer.get("noul", 0)))))
                supported_label, review_label = QUALITY_LABELS
                selected = supported_label if support_probability >= 0.5 else review_label
                probabilities = {supported_label: support_probability, review_label: 1 - support_probability}
                decisions.append({"id": item["id"], "label": selected, "confidence": min(1, max(0, confidence)), "probabilities": probabilities})
                continue
            allowed = SEMANTIC_LABELS
            uncertain_label = allowed[-1]
            raw_probabilities = answer.get("probabilities", {})
            probabilities = {candidate: min(1, max(0, float(raw_probabilities.get(candidate, 0)))) for candidate in allowed}
            total = sum(probabilities.values())
            label = answer.get("choice", uncertain_label)
            selected = label if label in allowed else uncertain_label
            decision = {"id": item["id"], "label": selected, "confidence": min(1, max(0, confidence))}
            if total <= 0:
                raise ValueError("semantic probabilities missing")
            normalized = {candidate: probability / total for candidate, probability in probabilities.items()}
            if normalized[selected] != max(normalized.values()):
                raise ValueError("semantic choice and probability argmax disagree")
            calibrated = temperature_scale(normalized, self.calibrator_temperature) if self.calibrator_temperature is not None else normalized
            if calibrated[selected] != max(calibrated.values()):
                raise ValueError("calibrator changed argmax")
            decision.update(label=selected, confidence=calibrated[selected], probabilities=calibrated)
            decisions.append(decision)
        return decisions


def valid_request(value: Any) -> bool:
    if not isinstance(value, dict) or set(value) != {"kind", "requestId", "inputDigest", "contractVersion", "snapshotVersion", "items"} or value.get("kind") not in (QUALITY_KIND, FREE_RESPONSE_KIND): return False
    if not isinstance(value.get("requestId"), str) or not 0 < len(value["requestId"]) <= MAX_REQUEST_ID_CHARS: return False
    if not isinstance(value.get("inputDigest"), str) or re.fullmatch(r"[a-f0-9]{64}", value["inputDigest"]) is None: return False
    if value.get("contractVersion") != CONTRACT_VERSION or value.get("snapshotVersion") != SNAPSHOT_VERSION: return False
    items = value.get("items")
    limit = MAX_BATCH if value["kind"] == QUALITY_KIND else MAX_SEMANTIC_BATCH
    if not isinstance(items, list) or not 0 < len(items) <= limit: return False
    if len({item.get("id") for item in items if isinstance(item, dict)}) != len(items): return False
    for item in items:
        if value["kind"] == QUALITY_KIND:
            if not isinstance(item, dict) or not set(item).issubset({"id", "question", "correctAnswer", "options", "language", "evidence"}): return False
            if not all(isinstance(item.get(key), str) and 0 < len(item[key]) <= size for key, size in (("id", MAX_ITEM_ID_CHARS), ("question", MANIFEST["limits"]["questionChars"]), ("correctAnswer", MANIFEST["limits"]["optionChars"]))): return False
            if not supported_english(item.get("language")) or not valid_evidence(item.get("evidence")): return False
            options = item.get("options", [])
            if not isinstance(options, list) or len(options) > MAX_OPTION_COUNT or any(not isinstance(option, str) or not 0 < len(option) <= MANIFEST["limits"]["optionChars"] for option in options): return False
        else:
            if not isinstance(item, dict) or set(item) != {"id", "question", "questionType", "expectedAnswer", "learnerAnswer", "evidenceExcerpt", "language", "rubricVersion", "rubric"}: return False
            if item.get("questionType") not in ("free-response", "fill_in_the_blank") or item.get("rubricVersion") != FREE_RESPONSE_KIND: return False
            if not all(isinstance(item.get(key), str) and 0 < len(item[key]) <= size for key, size in (("id", MAX_ITEM_ID_CHARS), ("question", MANIFEST["limits"]["questionChars"]), ("expectedAnswer", MANIFEST["limits"]["optionChars"]), ("learnerAnswer", MANIFEST["limits"]["learnerAnswerChars"]), ("evidenceExcerpt", MANIFEST["limits"]["evidenceChars"]))): return False
            if not supported_english(item.get("language")): return False
            rubric = item.get("rubric")
            if not isinstance(rubric, list) or len(rubric) != len(SEMANTIC_LABELS): return False
            if any(not isinstance(entry, dict) or set(entry) != {"label", "description"} or (entry.get("label"), entry.get("description")) != SEMANTIC_RUBRIC[index] for index, entry in enumerate(rubric)): return False
    return True


def supported_english(value: Any) -> bool:
    if not isinstance(value, str): return False
    normalized = value.strip().lower().replace("_", "-")
    return any(normalized.startswith(pattern[:-1]) if pattern.endswith("*") else normalized == pattern for pattern in MANIFEST["supportedLanguages"])


def valid_evidence(value: Any) -> bool:
    return isinstance(value, dict) and set(value) == {"sourceIndex", "excerpt"} \
        and isinstance(value.get("sourceIndex"), int) and not isinstance(value["sourceIndex"], bool) and value["sourceIndex"] >= 0 \
        and isinstance(value.get("excerpt"), str) and 0 < len(value["excerpt"]) <= MANIFEST["limits"]["evidenceChars"]


def create_app(backend: Backend | None):
    inference_lock = Lock()
    def evidence_headers(value: Backend | None) -> dict[str, str]:
        if isinstance(value, FakeBackend): return {"X-Laya-Evidence-Backend": "fake"}
        if isinstance(value, LayaBackend): return value.evidence_headers()
        return {"X-Laya-Evidence-Backend": "unknown"}
    def normal_ready(value: Backend | None) -> bool:
        return value is not None and (not isinstance(value, LayaBackend) or value.calibrator_sha256 is not None)
    def raw_fit_ready(value: Backend | None) -> bool:
        return isinstance(value, LayaBackend) and value.calibrator_sha256 is None and value.calibration_mode == "fit"
    state = {"backend": backend, "ready": normal_ready(backend), "rawFitReady": raw_fit_ready(backend), "evidenceHeaders": evidence_headers(backend)}
    def set_backend(value: Backend | None): state.update(backend=value, ready=normal_ready(value), rawFitReady=raw_fit_ready(value), evidenceHeaders=evidence_headers(value))
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format: str, *_args: Any) -> None: pass
        def send_json(self, status: int, payload: dict[str, Any], headers: dict[str, str] | None = None) -> None:
            raw = json.dumps(payload, separators=(",", ":")).encode()
            self.send_response(status); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(raw)))
            for name, value in (headers or {}).items(): self.send_header(name, value)
            self.end_headers(); self.wfile.write(raw)
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
            if not state["ready"] and not (state["rawFitReady"] and body["kind"] == FREE_RESPONSE_KIND): self.send_json(503, {"error": "Unavailable"}); return
            try:
                with inference_lock: decisions = state["backend"].evaluate(body["kind"], body["items"])
                if not isinstance(decisions, list) or {item.get("id") for item in decisions if isinstance(item, dict)} != {item["id"] for item in body["items"]} or len(decisions) != len(body["items"]): raise ValueError("invalid backend result")
                self.send_json(200, {"status": "completed", "provider": "laya", "modelRevision": MODEL_REVISION, "decisions": decisions}, state["evidenceHeaders"])
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
