#!/bin/bash
set -e

MARKER="/opt/dia-server/.installed"
export DEBIAN_FRONTEND=noninteractive

if [ ! -f "$MARKER" ]; then
  apt-get update
  apt-get install -y nvidia-driver-535 nvidia-cuda-toolkit python3.11 python3.11-venv ffmpeg

  mkdir -p /opt/dia-server
  cp /tmp/dia-server/* /opt/dia-server/ 2>/dev/null || true

  python3.11 -m venv /opt/dia-server/venv
  /opt/dia-server/venv/bin/pip install --upgrade pip
  /opt/dia-server/venv/bin/pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu121
  /opt/dia-server/venv/bin/pip install -r /opt/dia-server/requirements.txt

  /opt/dia-server/venv/bin/python -c "from dia.model import Dia; Dia.from_pretrained('nari-labs/Dia-1.6B')"

  touch "$MARKER"
fi

cd /opt/dia-server
source venv/bin/activate
exec uvicorn main:app --host 0.0.0.0 --port 8080 --workers 1 --timeout-keep-alive 75
