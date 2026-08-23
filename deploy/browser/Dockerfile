FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ca-certificates curl fonts-liberation \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin chrome \
  && mkdir -p /home/chrome/profile \
  && chown -R chrome:chrome /home/chrome

USER chrome
WORKDIR /home/chrome
EXPOSE 9222

# Chromium's Linux namespace sandbox cannot initialize inside the restricted
# Webdock/GitHub Docker boundary without broad container privileges. Keep the
# browser itself non-root and disable only Chromium's inner sandbox; Compose
# supplies the outer isolation boundary (default seccomp, no-new-privileges,
# all capabilities dropped, read-only root filesystem, internal-only network).
CMD ["/usr/bin/chromium", "--headless=new", "--no-sandbox", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "--remote-allow-origins=*", "--user-data-dir=/home/chrome/profile", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-gpu", "--disable-features=Translate,MediaRouter", "about:blank"]
