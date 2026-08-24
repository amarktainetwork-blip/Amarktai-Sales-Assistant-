FROM python:3.12.11-slim-bookworm

ARG PIPER_VERSION=1.7.0
ARG PIPER_VOICES_REV=f5a6e9094787fd865d65cb024472f977f9c542b5
ARG PIPER_VOICE=en_US-lessac-medium
ARG PIPER_MODEL_SHA256=5efe09e69902187827af646e1a6e9d269dee769f9877d17b16b1b46eeaaf019f
ARG PIPER_CONFIG_SHA256=efe19c417bed055f2d69908248c6ba650fa135bc868b0e6abb3da181dab690a0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && python -m pip install --no-cache-dir "piper-tts[http]==${PIPER_VERSION}" \
  && groupadd --system --gid 10003 tts \
  && useradd --system --uid 10003 --gid tts --home-dir /nonexistent --shell /usr/sbin/nologin tts \
  && mkdir -p /voices \
  && curl --fail --location --retry 4 --output "/voices/${PIPER_VOICE}.onnx" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_US/lessac/medium/${PIPER_VOICE}.onnx" \
  && curl --fail --location --retry 4 --output "/voices/${PIPER_VOICE}.onnx.json" \
    "https://huggingface.co/rhasspy/piper-voices/resolve/${PIPER_VOICES_REV}/en/en_US/lessac/medium/${PIPER_VOICE}.onnx.json" \
  && echo "${PIPER_MODEL_SHA256}  /voices/${PIPER_VOICE}.onnx" | sha256sum -c - \
  && echo "${PIPER_CONFIG_SHA256}  /voices/${PIPER_VOICE}.onnx.json" | sha256sum -c - \
  && chown -R tts:tts /voices

USER tts
EXPOSE 5000
HEALTHCHECK --interval=20s --timeout=5s --start-period=30s --retries=10 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/info', timeout=3).read()" || exit 1
ENTRYPOINT ["python", "-m", "piper.http_server", "--host", "0.0.0.0", "--port", "5000", "--data-dir", "/voices", "--model", "en_US-lessac-medium"]
