import asyncio
import io
import os
import re
import subprocess
import time
from contextlib import asynccontextmanager

import numpy as np
import soundfile as sf
import torch
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

model = None
inference_lock = asyncio.Lock()
last_activity = time.time()

API_KEY = os.environ.get("DIA_API_KEY", "")
MODEL_ID = os.environ.get("DIA_MODEL_ID", "nari-labs/Dia-1.6B-0626")
SAMPLE_RATE = 44100
PLAYBACK_SPEED = 0.82
CHUNK_SIZE = 6
CHAIN_TAIL_SECONDS = 10


@asynccontextmanager
async def lifespan(app: FastAPI):
    global model
    from dia.model import Dia

    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True
    torch.backends.cudnn.benchmark = True

    model = Dia.from_pretrained(MODEL_ID, compute_dtype="bfloat16")
    model.generate("[S1] Warmup.", max_tokens=256, verbose=False)
    print(f"Ready. Model={MODEL_ID}")
    yield


app = FastAPI(lifespan=lifespan)


class SynthRequest(BaseModel):
    text: str
    speaker: str


class DialogueRequest(BaseModel):
    script: str
    max_tokens: int | None = None


def _estimate_max_tokens(text: str) -> int:
    clean = text.replace("[S1]", "").replace("[S2]", "").strip()
    words = len(clean.split())
    tokens = int(words * 40) + 300
    return min(max(tokens, 350), 3072)


def _split_into_turns(script: str) -> list[str]:
    parts = re.split(r'(?=\[S[12]\])', script.strip())
    return [p.strip() for p in parts if p.strip()]


def _chunk_turns(turns: list[str], chunk_size: int) -> list[list[str]]:
    chunks = []
    for i in range(0, len(turns), chunk_size):
        chunks.append(turns[i:i + chunk_size])
    return chunks


def _generate_chunk(script: str, audio_prompt_path: str | None = None) -> np.ndarray:
    max_tok = _estimate_max_tokens(script)
    return model.generate(
        script,
        max_tokens=max_tok,
        cfg_scale=3.0,
        temperature=1.2,
        top_p=0.95,
        audio_prompt=audio_prompt_path,
        use_torch_compile=False,
        verbose=False,
    )


def _generate_chained(script: str) -> np.ndarray:
    turns = _split_into_turns(script)

    if len(turns) <= CHUNK_SIZE:
        return _generate_chunk(script)

    chunks = _chunk_turns(turns, CHUNK_SIZE)
    all_audio = []
    prev_combined = None

    for ci, chunk in enumerate(chunks):
        chunk_script = " ... ".join(chunk)

        prompt_path = None
        if prev_combined is not None:
            tail_samples = int(SAMPLE_RATE * CHAIN_TAIL_SECONDS)
            tail = prev_combined[-tail_samples:]
            prompt_path = "/opt/dia-server/chain_prompt.wav"
            sf.write(prompt_path, tail, SAMPLE_RATE)

        out = _generate_chunk(chunk_script, prompt_path)

        if prompt_path is not None and len(out) > int(SAMPLE_RATE * CHAIN_TAIL_SECONDS):
            out = out[int(SAMPLE_RATE * CHAIN_TAIL_SECONDS):]

        all_audio.append(out)
        prev_combined = np.concatenate(all_audio)

    return np.concatenate(all_audio)


def audio_to_mp3(audio: np.ndarray, sample_rate: int = SAMPLE_RATE, speed: float = PLAYBACK_SPEED) -> bytes:
    pcm16 = (audio * 32767).clip(-32768, 32767).astype(np.int16)
    cmd = [
        "ffmpeg", "-y", "-f", "s16le", "-ar", str(sample_rate),
        "-ac", "1", "-i", "pipe:0",
        "-filter:a", f"atempo={speed}",
        "-codec:a", "libmp3lame", "-b:a", "128k",
        "-f", "mp3", "pipe:1",
    ]
    proc = subprocess.run(cmd, input=pcm16.tobytes(), capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {proc.stderr.decode()[:200]}")
    return proc.stdout


def verify_key(x_api_key: str = Header(...)):
    if not API_KEY:
        return
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@app.post("/synthesize", dependencies=[Depends(verify_key)])
async def synthesize(req: SynthRequest):
    global last_activity
    last_activity = time.time()

    if req.speaker not in ("S1", "S2"):
        raise HTTPException(status_code=400, detail="speaker must be S1 or S2")

    tagged_text = f"[{req.speaker}] {req.text}"
    max_tok = _estimate_max_tokens(tagged_text)

    t0 = time.time()
    async with inference_lock:
        output = await asyncio.to_thread(
            model.generate, tagged_text,
            max_tokens=max_tok, cfg_scale=3.0,
            temperature=1.2, top_p=0.95,
            use_torch_compile=False, verbose=False,
        )
    gen_time = time.time() - t0

    if output is None or len(output) == 0:
        raise HTTPException(status_code=502, detail="Dia produced empty audio")

    audio_dur = len(output) / SAMPLE_RATE / PLAYBACK_SPEED
    mp3_bytes = audio_to_mp3(output)

    return Response(
        content=mp3_bytes, media_type="audio/mpeg",
        headers={"X-Generation-Time": f"{gen_time:.1f}", "X-Audio-Duration": f"{audio_dur:.1f}"},
    )


@app.post("/dialogue", dependencies=[Depends(verify_key)])
async def dialogue(req: DialogueRequest):
    global last_activity
    last_activity = time.time()

    t0 = time.time()
    async with inference_lock:
        output = await asyncio.to_thread(_generate_chained, req.script)
    gen_time = time.time() - t0

    if output is None or len(output) == 0:
        raise HTTPException(status_code=502, detail="Dia produced empty audio")

    audio_dur = len(output) / SAMPLE_RATE / PLAYBACK_SPEED
    mp3_bytes = audio_to_mp3(output)

    return Response(
        content=mp3_bytes, media_type="audio/mpeg",
        headers={"X-Generation-Time": f"{gen_time:.1f}", "X-Audio-Duration": f"{audio_dur:.1f}"},
    )


@app.get("/health")
async def health():
    return {"status": "ready", "model_loaded": model is not None}


@app.get("/last-activity")
async def activity():
    idle = int(time.time() - last_activity)
    return {
        "idle_seconds": idle,
        "last_request_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last_activity)),
    }
