FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates curl fonts-liberation nginx \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin chrome \
  && mkdir -p /home/chrome/profile /home/chrome/.cache /home/chrome/.config /home/chrome/.local /home/chrome/.pki \
  && chown -R chrome:chrome /home/chrome

COPY deploy/browser/nginx.conf /etc/nginx/nginx.conf

USER chrome
WORKDIR /home/chrome
EXPOSE 9222

# Chromium's Linux namespace sandbox cannot initialize inside the restricted
# Webdock/GitHub Docker boundary without broad container privileges. Keep the
# browser itself non-root and disable only Chromium's inner sandbox; Compose
# supplies the outer isolation boundary (default seccomp, no-new-privileges,
# all capabilities dropped, read-only root filesystem, internal-only network).
# Current Chromium deliberately binds headless DevTools to loopback even when a
# broader address is requested. Nginx remains internal to this non-root,
# capability-free container, exposes port 9222 only to the Compose network, and
# rewrites Chromium's loopback WebSocket URL to the stable Compose service name.
# The process profile is ephemeral. Organisation/connection-scoped encrypted
# storage packages are the only durable CRM browser identities.
CMD ["sh", "-eu", "-c", "nginx -c /etc/nginx/nginx.conf; exec /usr/bin/chromium --headless=new --no-sandbox --enable-automation --remote-debugging-address=127.0.0.1 --remote-debugging-port=9223 --remote-allow-origins=* --user-data-dir=/tmp/chrome-profile --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update --disable-sync --disable-gpu --disable-features=Translate,MediaRouter about:blank"]
