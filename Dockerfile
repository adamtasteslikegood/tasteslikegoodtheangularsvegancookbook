# Build stage
FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# Runtime stage
FROM node:26-alpine
WORKDIR /app
COPY --from=datadog/serverless-init:1 /datadog-init /app/datadog-init
ENV NODE_ENV=production
ENV DD_SERVICE=express-frontend
ENV DD_SITE=us5.datadoghq.com
ENV DD_LOGS_ENABLED=true
ENV DD_LOGS_INJECTION=true
ENV DD_SOURCE=nodejs
ENV DD_PROFILING_ENABLED=true
ENV DD_APPSEC_ENABLED=true
ENV NODE_OPTIONS=--require dd-trace/init
COPY --from=build /app/dist ./dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/public ./server/public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8080
ENTRYPOINT ["/app/datadog-init"]
CMD ["node", "server/dist/index.js"]
