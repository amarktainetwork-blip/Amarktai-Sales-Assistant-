FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium chromium-sandbox ca-certificates curl fonts-liberation \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --create-home --uid 10001 --shell /usr/sbin/nologin chrome \
  && mkdir -p /home/chrome/profile \
  && chown -R chrome:chrome /home/chrome \
  && test -u /usr/lib/chromium/chrome-sandbox

USER chrome
WORKDIR /home/chrome
EXPOSE 9222

CMD ["/usr/bin/chromium", "--headless=new", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "--remote-allow-origins=*", "--user-data-dir=/home/chrome/profile", "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--disable-gpu", "--disable-features=Translate,MediaRouter", "about:blank"]
