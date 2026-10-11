# Nightly gbrain maintenance cron service (Railway).
# Runs `gbrain extract --stale` + `gbrain embed --stale` against the shared
# Railway Postgres brain, then exits (Railway cron requires the process to exit).
#
# gbrain is NOT on npm (the npm "gbrain" package is an unrelated GPU library).
# It is built from source and pinned by commit SHA so this service never runs
# schema migrations the owner's local gbrain hasn't seen. Bump GBRAIN_COMMIT
# in lockstep with local gbrain upgrades (locally: git -C ~/gbrain rev-parse HEAD).
# gbrain 0.60 declares engines.bun >= 1.4.0.
FROM oven/bun:1.4

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# d4dc2d4d831503739e3c1551fdb01b4108457731 = v0.60.139.0
ARG GBRAIN_COMMIT=d4dc2d4d831503739e3c1551fdb01b4108457731
RUN git clone https://github.com/garrytan/gbrain.git /opt/gbrain \
    && git -C /opt/gbrain checkout "$GBRAIN_COMMIT" \
    && cd /opt/gbrain \
    && bun install

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
