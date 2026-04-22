import os

import functions_framework
import requests
from google.cloud import compute_v1

PROJECT = os.environ["GCP_PROJECT_ID"]
ZONE = os.environ.get("DIA_ZONE", "us-east1-b")
INSTANCE = os.environ.get("DIA_INSTANCE", "dia-tts")
STATIC_IP = os.environ["DIA_STATIC_IP"]
PORT = int(os.environ.get("DIA_PORT", "8080"))
IDLE_THRESHOLD = int(os.environ.get("IDLE_THRESHOLD_SECONDS", "600"))


@functions_framework.http
def stop_if_idle(request):
    client = compute_v1.InstancesClient()
    instance = client.get(project=PROJECT, zone=ZONE, instance=INSTANCE)

    if instance.status != "RUNNING":
        return ({"status": "already_stopped"}, 200)

    try:
        r = requests.get(f"http://{STATIC_IP}:{PORT}/last-activity", timeout=5)
        idle_seconds = r.json().get("idle_seconds", 0)
        if idle_seconds > IDLE_THRESHOLD:
            client.stop(project=PROJECT, zone=ZONE, instance=INSTANCE)
            return ({"status": "stopped", "idle_seconds": idle_seconds}, 200)
        return ({"status": "still_active", "idle_seconds": idle_seconds}, 200)
    except Exception as e:
        return ({"status": "unreachable", "error": str(e)}, 200)
