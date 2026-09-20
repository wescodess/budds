FROM python:3.11-slim AS builder
ARG LAYA_MODEL_REVISION=f9ab0b228f0fc0f14d873dbc99038f135c2da1b2
ENV HF_HOME=/opt/hf
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu "torch==2.6.0" \
 && pip install --no-cache-dir -r /tmp/requirements.txt
RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('convaiinnovations/laya-typed-decisions', revision='${LAYA_MODEL_REVISION}', local_dir='/opt/laya-model')" \
 && echo "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e  /opt/laya-model/model.safetensors" | sha256sum -c -

FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 LAYA_MODEL_PATH=/opt/laya-model PORT=8080
COPY --from=builder /usr/local /usr/local
COPY --from=builder /usr/local/lib/python3.11/site-packages/laya-0.3.3.dist-info/licenses/LICENSE /licenses/LAYA-APACHE-2.0.txt
COPY --from=builder /opt/laya-model /opt/laya-model
WORKDIR /app
COPY service/app.py /app/app.py
COPY learningDecisionManifest.json /app/learningDecisionManifest.json
COPY THIRD_PARTY_NOTICES.md /licenses/THIRD_PARTY_NOTICES.md
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app /opt/laya-model
USER appuser
EXPOSE 8080
CMD ["python", "/app/app.py"]
