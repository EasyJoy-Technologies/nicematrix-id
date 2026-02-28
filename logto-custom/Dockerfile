###### [STAGE] Build (source-based) ######
FROM node:22-alpine as builder
WORKDIR /etc/logto
ENV CI=true
ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN npm add --location=global pnpm@^10.0.0
RUN apk add --no-cache python3 make g++ rsync

# 1) Upstream source
COPY logto-upstream/ .

# 2) NiceMatrix source overrides (no dist patching)
COPY logto-custom/overrides/ /tmp/overrides/
RUN if [ -d /tmp/overrides ]; then rsync -a /tmp/overrides/ /etc/logto/; fi

# Build args aligned with upstream Dockerfile behavior
ARG dev_features_enabled
ENV DEV_FEATURES_ENABLED=${dev_features_enabled}

ARG applicationinsights_connection_string
ENV APPLICATIONINSIGHTS_CONNECTION_STRING=${applicationinsights_connection_string}

ARG additional_connector_args
ENV ADDITIONAL_CONNECTOR_ARGS=${additional_connector_args}

RUN pnpm i
RUN pnpm -r build
RUN pnpm cli connector link $ADDITIONAL_CONNECTOR_ARGS -p .

RUN rm -rf node_modules packages/**/node_modules
RUN NODE_ENV=production pnpm i
RUN rm -rf .scripts pnpm-*.yaml packages/cloud

###### [STAGE] Seal ######
FROM node:22-alpine as app
WORKDIR /etc/logto
COPY --from=builder /etc/logto .
RUN mkdir -p /etc/logto/packages/cli/alteration-scripts && chmod g+w /etc/logto/packages/cli/alteration-scripts
EXPOSE 3001
ENTRYPOINT ["npm", "run"]
CMD ["start"]
