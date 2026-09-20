import hashlib
import json
import math
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import CALIBRATOR_METHOD, CALIBRATOR_SCHEMA_VERSION, CONTRACT_VERSION, EVALUATION_MANIFEST_SHA256, FakeBackend, LayaBackend, MANIFEST, MANIFEST_PATH, MAX_BODY_BYTES, MAX_ITEM_ID_CHARS, MAX_OPTION_COUNT, MAX_REQUEST_ID_CHARS, QUALITY_LABELS, SEMANTIC_LABELS, SNAPSHOT_VERSION, build_laya_input, create_app, load_calibrator, temperature_scale, valid_request


def payload():
    return {"kind": "quiz_quality", "requestId": "r1", "inputDigest": "a" * 64, "contractVersion": CONTRACT_VERSION, "snapshotVersion": SNAPSHOT_VERSION, "items": [{"id": "q1", "question": "What is ATP?", "options": ["Energy"], "correctAnswer": "Energy", "language": "en", "evidence": {"sourceIndex": 0, "excerpt": "ATP transfers energy."}}]}


def semantic_payload():
    return {"kind": "quiz.free_response_assessment.v1", "requestId": "s1", "inputDigest": "b" * 64, "contractVersion": CONTRACT_VERSION, "snapshotVersion": SNAPSHOT_VERSION, "items": [{"id": "a1", "question": "Describe ATP.", "questionType": "free-response", "expectedAnswer": "Energy carrier", "learnerAnswer": "Carries energy", "evidenceExcerpt": "ATP carries chemical energy.", "language": "en-CA", "rubricVersion": "quiz.free_response_assessment.v1", "rubric": [dict(entry) for entry in MANIFEST["decisionKinds"]["freeResponse"]["rubric"]]}]}


def call(server, method, path, body=None, declared_length=None):
    raw = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    headers = {"Content-Type": "application/json"}
    if declared_length is not None:
        headers["Content-Length"] = str(declared_length)
    request = urllib.request.Request(f"http://127.0.0.1:{server.server_port}{path}", data=raw, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=2) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def call_with_headers(server, body):
    raw = json.dumps(body).encode()
    request = urllib.request.Request(
        f"http://127.0.0.1:{server.server_port}/v1/evaluate",
        data=raw,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=2) as response:
        return response.status, json.loads(response.read()), dict(response.headers.items())


def calibrator(provenance, temperature=2.0):
    return {
        "schemaVersion": CALIBRATOR_SCHEMA_VERSION,
        "status": "fitted",
        "method": CALIBRATOR_METHOD,
        "labels": list(SEMANTIC_LABELS),
        "bounds": {"minimumTemperature": 0.05, "maximumTemperature": 10},
        "epsilon": 1e-12,
        "fitCorpus": {
            "path": "workers/laya-evaluator/calibration/corpus.v1.jsonl",
            "version": "laya-semantic-synthetic.v1",
            "sha256": "c" * 64,
        },
        "pins": provenance,
        "fitResult": {"temperature": temperature, "negativeLogLikelihood": 0.75, "iterations": 12},
    }


def with_room_for_state(agent, *, max_len=10_000, head_max_len=100):
    agent.cfg = {"max_len": max_len, "head_max_len": head_max_len}
    agent.tok = lambda value, add_special_tokens=False: {"input_ids": list(value)}
    return agent


def running_app(backend):
    handler, set_backend = create_app(backend)
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, set_backend


class LayaServiceTests(unittest.TestCase):
    def test_liveness_is_independent_from_readiness_and_warming_fails_closed(self):
        server, set_backend = running_app(None)
        try:
            self.assertEqual(call(server, "GET", "/health/live"), (200, {"live": True}))
            self.assertEqual(call(server, "GET", "/health/ready")[0], 503)
            self.assertEqual(call(server, "POST", "/v1/evaluate", payload())[0], 503)
            set_backend(FakeBackend())
            self.assertEqual(call(server, "GET", "/health/ready")[0], 200)
            status, result = call(server, "POST", "/v1/evaluate", payload())
            self.assertEqual(status, 200)
            self.assertEqual(result["decisions"][0]["label"], "supported")
            self.assertEqual(result["decisions"][0]["confidence"], 1.0)
            self.assertEqual(result["decisions"][0]["probabilities"], {"supported": 1.0, "needs_review": 0.0})
        finally:
            server.shutdown(); server.server_close()

    def test_http_validation_rejects_unknown_fields_bad_batches_and_large_bodies(self):
        self.assertTrue(valid_request(payload()))
        self.assertFalse(valid_request({**payload(), "unknown": True}))
        self.assertFalse(valid_request({**payload(), "items": []}))
        self.assertFalse(valid_request({**payload(), "requestId": ""}))
        self.assertFalse(valid_request({**payload(), "inputDigest": "z" * 64}))
        self.assertEqual(MANIFEST["manifestVersion"], "budds.learning-decisions.v2")
        self.assertEqual(MAX_REQUEST_ID_CHARS, MANIFEST["limits"]["requestIdChars"])
        self.assertEqual(MAX_ITEM_ID_CHARS, MANIFEST["limits"]["itemIdChars"])
        self.assertEqual(MAX_OPTION_COUNT, MANIFEST["limits"]["optionCount"])
        self.assertEqual(QUALITY_LABELS, tuple(MANIFEST["decisionKinds"]["quizQuality"]["labels"]))
        self.assertEqual(SEMANTIC_LABELS, tuple(MANIFEST["decisionKinds"]["freeResponse"]["labels"]))
        duplicate = payload(); duplicate["items"].append(dict(duplicate["items"][0]))
        self.assertFalse(valid_request(duplicate))
        invalid_item = payload(); invalid_item["items"][0]["unknown"] = True
        self.assertFalse(valid_request(invalid_item))
        self.assertTrue(valid_request(semantic_payload()))
        invalid_semantic = semantic_payload(); invalid_semantic["items"][0]["evidenceExcerpt"] = ""
        self.assertFalse(valid_request(invalid_semantic))
        changed_policy = semantic_payload(); changed_policy["items"][0]["rubric"][0]["description"] = "changed policy"
        self.assertFalse(valid_request(changed_policy))
        server, _ = running_app(FakeBackend())
        try:
            self.assertEqual(call(server, "POST", "/v1/evaluate", {"unexpected": True})[0], 422)
            self.assertEqual(call(server, "POST", "/v1/evaluate", b"{}", declared_length=MAX_BODY_BYTES + 1)[0], 413)
            self.assertEqual(call(server, "POST", "/missing", payload())[0], 404)
        finally:
            server.shutdown(); server.server_close()

    def test_laya_input_contains_exactly_one_flat_item(self):
        batch = payload()["items"] + [{"id": "q2", "question": "What is DNA?", "correctAnswer": "Genetic material", "language": "en", "evidence": {"sourceIndex": 1, "excerpt": "DNA stores genetic material."}}]
        state, questions = build_laya_input("quiz_quality", batch[0])
        self.assertEqual(set(state), {"question", "options", "correctAnswer", "language", "sourceIndex", "sourceExcerpt"})
        self.assertEqual(questions["q1"]["type"], "noul")
        self.assertEqual(state["sourceExcerpt"], "ATP transfers energy.")
        self.assertNotIn("q2", json.dumps(state))

        semantic = semantic_payload()
        state, questions = build_laya_input(semantic["kind"], semantic["items"][0])
        self.assertEqual(state["learnerAnswer"], "Carries energy")
        self.assertEqual(set(questions["a1"]["criteria"]), {"fully_correct", "partially_correct", "incorrect", "uncertain"})
        self.assertLessEqual(len(questions["a1"]["instructions"]), 240)
        self.assertLessEqual(sum(len(value) for value in questions["a1"]["criteria"].values()), 500)
        self.assertTrue(all(len(value) <= 140 for value in questions["a1"]["criteria"].values()))

    def test_laya_backend_isolates_unrelated_items_into_singleton_predict_calls(self):
        class RecordingAgent:
            def __init__(self): self.calls = []
            def predict(self, state, questions):
                self.calls.append((state, questions))
                item_id = next(iter(questions))
                return {"answers": {item_id: {"probability": 0.75, "confidence": 0.5}}}

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = with_room_for_state(RecordingAgent())
        base = payload()["items"][0]
        items = [base, {**base, "id": "q2", "question": "What is DNA?", "correctAnswer": "Genetic material", "evidence": {"sourceIndex": 1, "excerpt": "DNA stores genetic material."}}]

        decisions = backend.evaluate("quiz_quality", items)

        self.assertEqual([decision["id"] for decision in decisions], ["q1", "q2"])
        self.assertEqual(len(backend.agent.calls), 2)
        first_state, first_questions = backend.agent.calls[0]
        second_state, second_questions = backend.agent.calls[1]
        self.assertEqual(set(first_questions), {"q1"})
        self.assertEqual(set(second_questions), {"q2"})
        self.assertNotIn("DNA", json.dumps(first_state))
        self.assertNotIn("ATP", json.dumps(second_state))

    def test_laya_backend_fails_closed_before_state_truncation(self):
        class Agent:
            def predict(self, _state, _questions):
                raise AssertionError("predict must not run for an oversized state")

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = with_room_for_state(Agent(), max_len=80, head_max_len=40)

        with self.assertRaisesRegex(ValueError, "state exceeds model token budget"):
            backend.evaluate("quiz_quality", payload()["items"])

    def test_backend_failures_and_mismatched_ids_are_redacted_as_unavailable(self):
        class FailingBackend:
            def evaluate(self, _kind, _items): raise RuntimeError("sensitive raw model output")
        class WrongIdsBackend:
            def evaluate(self, _kind, _items): return [{"id": "other", "label": "supported", "confidence": 1}]
        for backend in (FailingBackend(), WrongIdsBackend()):
            server, _ = running_app(backend)
            try:
                self.assertEqual(call(server, "POST", "/v1/evaluate", payload()), (503, {"error": "Unavailable"}))
            finally:
                server.shutdown(); server.server_close()

    def test_production_backend_maps_noul_probabilities_with_fallback_threshold_and_clamping(self):
        class Agent:
            def __init__(self): self.questions = []
            def predict(self, _state, questions):
                self.questions.append(questions)
                item_id = next(iter(questions))
                answers = {
                    "q1": {"probability": 0.75, "confidence": 2},
                    "q2": {"noul": 0.49, "confidence": 0.4},
                    "q3": {"probability": -3, "confidence": -1},
                }
                return {"answers": {item_id: answers[item_id]}}

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = with_room_for_state(Agent())
        base = payload()["items"][0]
        items = [{**base, "id": key} for key in ("q1", "q2", "q3")]

        decisions = backend.evaluate("quiz_quality", items)

        self.assertEqual(len(backend.agent.questions), 3)
        self.assertTrue(all(next(iter(questions.values()))["type"] == "noul" for questions in backend.agent.questions))
        self.assertEqual(decisions[0], {"id": "q1", "label": "supported", "confidence": 1, "probabilities": {"supported": 0.75, "needs_review": 0.25}})
        self.assertEqual(decisions[1], {"id": "q2", "label": "needs_review", "confidence": 0.4, "probabilities": {"supported": 0.49, "needs_review": 0.51}})
        self.assertEqual(decisions[2], {"id": "q3", "label": "needs_review", "confidence": 0, "probabilities": {"supported": 0, "needs_review": 1}})

    def test_real_backend_observes_installed_package_model_bytes_and_exact_manifest_bytes(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LAYA_CALIBRATOR_PATH": "", "LAYA_CALIBRATION_MODE": ""}):
            model_directory = Path(directory)
            model_bytes = b"actual model bytes, not the manifest claim"
            (model_directory / "model.safetensors").write_bytes(model_bytes)
            observed_packages = []

            def resolve_package(name):
                observed_packages.append(name)
                return "9.8.7-observed"

            backend = LayaBackend(
                model_path=model_directory,
                model_revision="observed-revision",
                package_version_resolver=resolve_package,
                agent_loader=lambda _path: object(),
            )

            self.assertEqual(observed_packages, ["laya"])
            self.assertEqual(backend.provenance, {
                "packageVersion": "9.8.7-observed",
                "modelRevision": "observed-revision",
                "modelSha256": hashlib.sha256(model_bytes).hexdigest(),
                "evaluationManifestSha256": hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest(),
            })
            self.assertEqual(EVALUATION_MANIFEST_SHA256, hashlib.sha256(MANIFEST_PATH.read_bytes()).hexdigest())
            headers = backend.evidence_headers()
            self.assertEqual(headers["X-Laya-Evidence-Backend"], "real")
            self.assertEqual(headers["X-Laya-Package-Version"], "9.8.7-observed")
            self.assertEqual(headers["X-Laya-Model-Revision"], "observed-revision")
            self.assertEqual(headers["X-Laya-Model-SHA256"], hashlib.sha256(model_bytes).hexdigest())
            self.assertEqual(headers["X-Laya-Evaluation-Manifest-SHA256"], EVALUATION_MANIFEST_SHA256)
            self.assertEqual(headers["X-Laya-Calibrator-Status"], "absent")
            self.assertNotIn("X-Laya-Calibrator-SHA256", headers)

    def test_calibrator_loader_rejects_non_exact_invalid_or_mismatched_artifacts(self):
        provenance = {
            "packageVersion": "0.3.3",
            "modelRevision": "revision",
            "modelSha256": "a" * 64,
            "evaluationManifestSha256": "b" * 64,
        }
        invalid = []
        extra = calibrator(provenance); extra["unexpected"] = True; invalid.append(extra)
        invalid.append(calibrator(provenance, float("inf")))
        invalid.append(calibrator(provenance, 0.049))
        invalid.append(calibrator(provenance, 10.001))
        wrong_labels = calibrator(provenance); wrong_labels["labels"] = list(reversed(SEMANTIC_LABELS)); invalid.append(wrong_labels)
        wrong_pin = calibrator(provenance); wrong_pin["pins"] = {**provenance, "modelSha256": "c" * 64}; invalid.append(wrong_pin)
        wrong_status = calibrator(provenance); wrong_status["status"] = "draft"; invalid.append(wrong_status)
        wrong_epsilon = calibrator(provenance); wrong_epsilon["epsilon"] = 1e-9; invalid.append(wrong_epsilon)
        wrong_corpus = calibrator(provenance); wrong_corpus["fitCorpus"] = {**wrong_corpus["fitCorpus"], "sha256": "not-a-digest"}; invalid.append(wrong_corpus)
        wrong_nll = calibrator(provenance); wrong_nll["fitResult"] = {**wrong_nll["fitResult"], "negativeLogLikelihood": -1}; invalid.append(wrong_nll)
        wrong_iterations = calibrator(provenance); wrong_iterations["fitResult"] = {**wrong_iterations["fitResult"], "iterations": 0}; invalid.append(wrong_iterations)

        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / "calibrator.json"
            for value in invalid:
                with self.subTest(value=value):
                    artifact.write_text(json.dumps(value), encoding="utf-8")
                    with self.assertRaisesRegex(ValueError, "invalid calibrator"):
                        load_calibrator(artifact, provenance)

    def test_temperature_scaling_has_fixed_vector_parity_and_preserves_argmax(self):
        raw = {
            "fully_correct": 0.64,
            "partially_correct": 0.16,
            "incorrect": 0.16,
            "uncertain": 0.04,
        }
        scaled = temperature_scale(raw, 2.0)
        expected = {
            "fully_correct": 4 / 9,
            "partially_correct": 2 / 9,
            "incorrect": 2 / 9,
            "uncertain": 1 / 9,
        }
        for label in SEMANTIC_LABELS:
            self.assertTrue(math.isclose(scaled[label], expected[label], rel_tol=0, abs_tol=1e-12))
        self.assertEqual(max(raw, key=raw.get), max(scaled, key=scaled.get))

        class Agent:
            def predict(self, _state, _questions):
                return {"answers": {"a1": {"choice": "fully_correct", "confidence": 0.99, "probabilities": raw}}}

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = with_room_for_state(Agent())
        backend.calibrator_temperature = 2.0
        decision = backend.evaluate(semantic_payload()["kind"], semantic_payload()["items"])[0]
        self.assertEqual(decision["label"], "fully_correct")
        self.assertEqual(decision["probabilities"], scaled)
        self.assertEqual(decision["confidence"], scaled["fully_correct"])

    def test_valid_calibrator_sha_is_exposed_and_http_fake_cannot_claim_real_provenance(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LAYA_CALIBRATOR_PATH": "", "LAYA_CALIBRATION_MODE": ""}):
            model_directory = Path(directory) / "model"
            model_directory.mkdir()
            (model_directory / "model.safetensors").write_bytes(b"model")
            provenance = {
                "packageVersion": "0.3.3-observed",
                "modelRevision": "observed-revision",
                "modelSha256": hashlib.sha256(b"model").hexdigest(),
                "evaluationManifestSha256": EVALUATION_MANIFEST_SHA256,
            }
            artifact = Path(directory) / "calibrator.json"
            artifact_bytes = json.dumps(calibrator(provenance), separators=(",", ":")).encode()
            artifact.write_bytes(artifact_bytes)
            class Agent:
                def predict(self, _state, _questions):
                    return {"answers": {"q1": {"probability": 0.75, "confidence": 0.75}}}
            backend = LayaBackend(
                model_path=model_directory,
                model_revision="observed-revision",
                package_version_resolver=lambda _name: "0.3.3-observed",
                agent_loader=lambda _path: with_room_for_state(Agent()),
                calibrator_path=artifact,
            )
            self.assertEqual(backend.evidence_headers()["X-Laya-Calibrator-Status"], "valid")
            self.assertEqual(backend.evidence_headers()["X-Laya-Calibrator-SHA256"], hashlib.sha256(artifact_bytes).hexdigest())

            real_server, _ = running_app(backend)
            fake_server, _ = running_app(FakeBackend())
            try:
                status, _body, headers = call_with_headers(real_server, payload())
                self.assertEqual(status, 200)
                self.assertEqual(headers["X-Laya-Evidence-Backend"], "real")
                self.assertEqual(headers["X-Laya-Calibrator-SHA256"], hashlib.sha256(artifact_bytes).hexdigest())
                fake_status, _fake_body, fake_headers = call_with_headers(fake_server, payload())
                self.assertEqual(fake_status, 200)
                self.assertEqual(fake_headers["X-Laya-Evidence-Backend"], "fake")
                self.assertFalse(any(name.lower().startswith("x-laya-model-") for name in fake_headers))
                self.assertNotIn("X-Laya-Package-Version", fake_headers)
                self.assertNotIn("X-Laya-Evaluation-Manifest-SHA256", fake_headers)
                self.assertNotIn("X-Laya-Calibrator-SHA256", fake_headers)
            finally:
                real_server.shutdown(); real_server.server_close()
                fake_server.shutdown(); fake_server.server_close()

    def test_uncalibrated_real_backend_is_unready_except_in_explicit_fit_mode(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"LAYA_CALIBRATOR_PATH": "", "LAYA_CALIBRATION_MODE": ""}):
            model_directory = Path(directory)
            (model_directory / "model.safetensors").write_bytes(b"model")

            class Agent:
                def predict(self, _state, _questions):
                    return {"answers": {"a1": {
                        "choice": "fully_correct",
                        "confidence": 0.9,
                        "probabilities": {"fully_correct": 0.7, "partially_correct": 0.2, "incorrect": 0.05, "uncertain": 0.05},
                    }}}

            kwargs = {
                "model_path": model_directory,
                "package_version_resolver": lambda _name: "0.3.3",
                "agent_loader": lambda _path: with_room_for_state(Agent()),
            }
            normal_server, _ = running_app(LayaBackend(**kwargs))
            fit_server, _ = running_app(LayaBackend(
                **kwargs,
                calibrator_path=model_directory / "not-yet-fitted.json",
                calibration_mode="fit",
            ))
            try:
                self.assertEqual(call(normal_server, "GET", "/health/ready")[0], 503)
                self.assertEqual(call(normal_server, "POST", "/v1/evaluate", semantic_payload()), (503, {"error": "Unavailable"}))
                self.assertEqual(call(fit_server, "GET", "/health/ready")[0], 503)
                status, result, headers = call_with_headers(fit_server, semantic_payload())
                self.assertEqual(status, 200)
                self.assertEqual(result["decisions"][0]["probabilities"]["fully_correct"], 0.7)
                self.assertEqual(headers["X-Laya-Calibrator-Status"], "raw-fit")
                self.assertEqual(headers["X-Laya-Calibration-Mode"], "fit")
                self.assertNotIn("X-Laya-Calibrator-SHA256", headers)
            finally:
                normal_server.shutdown(); normal_server.server_close()
                fit_server.shutdown(); fit_server.server_close()

    def test_semantic_choice_probability_argmax_disagreement_fails(self):
        class Agent:
            def predict(self, _state, _questions):
                return {"answers": {"a1": {
                    "choice": "incorrect",
                    "confidence": 0.9,
                    "probabilities": {"fully_correct": 0.8, "partially_correct": 0.1, "incorrect": 0.05, "uncertain": 0.05},
                }}}

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = with_room_for_state(Agent())
        backend.calibrator_temperature = 2.0
        with self.assertRaisesRegex(ValueError, "argmax disagree"):
            backend.evaluate(semantic_payload()["kind"], semantic_payload()["items"])


if __name__ == "__main__":
    unittest.main()
