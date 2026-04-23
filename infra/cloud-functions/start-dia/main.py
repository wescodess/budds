import os
import time

import functions_framework
import requests
from google.cloud import compute_v1

PROJECT = os.environ["GCP_PROJECT_ID"]
ZONE = os.environ.get("DIA_ZONE", "us-east1-b")
INSTANCE = os.environ.get("DIA_INSTANCE", "dia-tts")
STATIC_IP = os.environ["DIA_STATIC_IP"]
PORT = int(os.environ.get("DIA_PORT", "8080"))
API_KEY = os.environ.get("FUNCTION_API_KEY", "")

MAX_BOOT_WAIT = 120
MAX_HEALTH_WAIT = 200
POLL_INTERVAL = 5


def _verify_caller(request):
    if not API_KEY:
        return
    key = request.headers.get("X-API-Key", "")
    if key != API_KEY:
        return ({"error": "unauthorized"}, 401)
    return None


@functions_framework.http
def start_dia(request):
    auth_err = _verify_caller(request)
    if auth_err:
        return auth_err

    client = compute_v1.InstancesClient()
    instance = client.get(project=PROJECT, zone=ZONE, instance=INSTANCE)

    if instance.status in ("TERMINATED", "STOPPED"):
        client.start(project=PROJECT, zone=ZONE, instance=INSTANCE)
        for _ in range(MAX_BOOT_WAIT // POLL_INTERVAL):
            time.sleep(POLL_INTERVAL)
            inst = client.get(project=PROJECT, zone=ZONE, instance=INSTANCE)
            if inst.status == "RUNNING":
                break
        else:
            return ({"status": "boot_timeout"}, 504)

    health_url = f"http://{STATIC_IP}:{PORT}/health"
    for _ in range(MAX_HEALTH_WAIT // POLL_INTERVAL):
        try:
            r = requests.get(health_url, timeout=3)
            if r.ok and r.json().get("model_loaded"):
                return ({"status": "ready", "ip": STATIC_IP}, 200)
        except Exception:
            pass
        time.sleep(POLL_INTERVAL)

    return ({"status": "health_timeout"}, 504)
