# Nightly gbrain maintenance cron service (Railway).
# Runs `gbrain dream` + `gbrain extract --stale` against the shared Railway
# Postgres brain, then exits (Railway cron requires the process to exit).
#
# gbrain is NOT on npm (the npm "gbrain" package is an unrelated GPU library).
# It is built from source and pinned by commit SHA so this service never runs
# schema migrations the owner's local gbrain hasn't seen. Bump GBRAIN_COMMIT
# in lockstep with local gbrain upgrades (locally: git -C ~/gbrain rev-parse HEAD).
FROM oven/bun:1.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 646179047a8e4ad9c462d83ce9a67a50ba076de8 = v0.42.56.0
ARG GBRAIN_COMMIT=646179047a8e4ad9c462d83ce9a67a50ba076de8
RUN git clone https://github.com/garrytan/gbrain.git /opt/gbrain \
    && git -C /opt/gbrain checkout "$GBRAIN_COMMIT" \
    && cd /opt/gbrain \
    && bun install

COPY run.sh /run.sh
RUN chmod +x /run.sh

CMD ["/run.sh"]
