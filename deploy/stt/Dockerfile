FROM debian:bookworm-slim AS build

ARG WHISPER_CPP_RELEASE=b4938
ARG WHISPER_MODEL_REV=5359861c739e955e79d9a303bcbc70fb988958b1
ARG WHISPER_MODEL=ggml-base-q5_1.bin
ARG WHISPER_MODEL_SHA256=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cmake curl g++ git make \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN git clone --branch "${WHISPER_CPP_RELEASE}" --depth 1 https://github.com/ggml-org/whisper.cpp.git . \
  && test "$(git rev-parse HEAD)" = "371b5a7561823ab2bb32142d2751e35e7534727b" \
  && cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build build --config Release --target whisper-server -j2 \
  && curl --fail --location --retry 4 --output "/${WHISPER_MODEL}" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/${WHISPER_MODEL_REV}/${WHISPER_MODEL}" \
  && echo "${WHISPER_MODEL_SHA256}  /${WHISPER_MODEL}" | sha256sum -c -

FROM debian:bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10002 stt \
  && useradd --system --uid 10002 --gid stt --home-dir /nonexistent --shell /usr/sbin/nologin stt
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /ggml-base-q5_1.bin /models/ggml-base-q5_1.bin
USER stt
EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=10 \
  CMD curl --fail --silent http://127.0.0.1:8080/ >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/whisper-server"]
CMD ["--host", "0.0.0.0", "--port", "8080", "--model", "/models/ggml-base-q5_1.bin", "--language", "auto", "--threads", "4", "--processors", "1", "--no-timestamps"]
