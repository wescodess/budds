import json
import sys
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import CONTRACT_VERSION, FakeBackend, LayaBackend, MANIFEST, MAX_BODY_BYTES, MAX_ITEM_ID_CHARS, MAX_OPTION_COUNT, MAX_REQUEST_ID_CHARS, QUALITY_LABELS, SEMANTIC_LABELS, SNAPSHOT_VERSION, build_laya_inputs, create_app, valid_request


def payload():
    return {"kind": "quiz_quality", "requestId": "r1", "inputDigest": "a" * 64, "contractVersion": CONTRACT_VERSION, "snapshotVersion": SNAPSHOT_VERSION, "items": [{"id": "q1", "question": "What is ATP?", "options": ["Energy"], "correctAnswer": "Energy", "language": "en", "evidence": {"sourceIndex": 0, "excerpt": "ATP transfers energy."}}]}


def semantic_payload():
    return {"kind": "quiz.free_response_assessment.v1", "requestId": "s1", "inputDigest": "b" * 64, "contractVersion": CONTRACT_VERSION, "snapshotVersion": SNAPSHOT_VERSION, "items": [{"id": "a1", "question": "Describe ATP.", "questionType": "free-response", "expectedAnswer": "Energy carrier", "learnerAnswer": "Carries energy", "evidenceExcerpt": "ATP carries chemical energy.", "language": "en-CA", "rubricVersion": "quiz.free_response_assessment.v1", "rubric": [{"label": "fully_correct", "description": "The response answers the question completely and is supported by the evidence."}, {"label": "partially_correct", "description": "The response contains a supported correct idea but is materially incomplete or has a minor error."}, {"label": "incorrect", "description": "The response is contradicted by the evidence, unsupported, or misses the requested concept."}, {"label": "uncertain", "description": "The evidence or response is insufficient to make a reliable assessment."}]}]}


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

    def test_laya_questions_identify_their_own_state_items(self):
        batch = payload()["items"] + [{"id": "q2", "question": "What is DNA?", "correctAnswer": "Genetic material", "language": "en", "evidence": {"sourceIndex": 1, "excerpt": "DNA stores genetic material."}}]
        state, questions = build_laya_inputs("quiz_quality", batch)
        self.assertEqual(set(state), {"q1", "q2"})
        self.assertEqual(questions["q1"]["type"], "noul")
        self.assertEqual(state["q1"]["sourceExcerpt"], "ATP transfers energy.")
        self.assertIn("'q1'", questions["q1"]["instructions"])
        self.assertIn("'q2'", questions["q2"]["instructions"])
        self.assertNotEqual(questions["q1"]["instructions"], questions["q2"]["instructions"])

        semantic = semantic_payload()
        state, questions = build_laya_inputs(semantic["kind"], semantic["items"])
        self.assertEqual(state["a1"]["learnerAnswer"], "Carries energy")
        self.assertEqual(set(questions["a1"]["criteria"]), {"fully_correct", "partially_correct", "incorrect", "uncertain"})

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
            def __init__(self): self.questions = None
            def predict(self, _state, questions):
                self.questions = questions
                return {"answers": {
                    "q1": {"probability": 0.75, "confidence": 2},
                    "q2": {"noul": 0.49, "confidence": 0.4},
                    "q3": {"probability": -3, "confidence": -1},
                }}

        backend = LayaBackend.__new__(LayaBackend)
        backend.agent = Agent()
        base = payload()["items"][0]
        items = [{**base, "id": key} for key in ("q1", "q2", "q3")]

        decisions = backend.evaluate("quiz_quality", items)

        self.assertTrue(all(question["type"] == "noul" for question in backend.agent.questions.values()))
        self.assertEqual(decisions[0], {"id": "q1", "label": "supported", "confidence": 1, "probabilities": {"supported": 0.75, "needs_review": 0.25}})
        self.assertEqual(decisions[1], {"id": "q2", "label": "needs_review", "confidence": 0.4, "probabilities": {"supported": 0.49, "needs_review": 0.51}})
        self.assertEqual(decisions[2], {"id": "q3", "label": "needs_review", "confidence": 0, "probabilities": {"supported": 0, "needs_review": 1}})


if __name__ == "__main__":
    unittest.main()
