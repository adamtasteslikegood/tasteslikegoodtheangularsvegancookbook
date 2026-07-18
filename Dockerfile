# Build stage
FROM node:26-alpine-does-not-exist AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage
FROM node:26-alpine
WORKDIR /app
# The :1 tag ships a glibc-dynamic binary whose /lib64 interpreter does not
# exist on this musl (alpine) base — the ENTRYPOINT would fail to exec and the
# container would never start. The -alpine tag ships a static binary.
COPY --from=datadog/serverless-init:1-alpine /datadog-init /app/datadog-init
ENV NODE_ENV=production
ENV DD_SERVICE=express-frontend
ENV DD_SITE=us5.datadoghq.com
ENV DD_LOGS_ENABLED=true
ENV DD_LOGS_INJECTION=true
ENV DD_SOURCE=nodejs
ENV DD_PROFILING_ENABLED=true
ENV DD_APPSEC_ENABLED=true
ENV NODE_OPTIONS="--require dd-trace/init"
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
ENTRYPOINT ["/app/datadog-init"]
CMD ["node", "server/dist/index.js"]
