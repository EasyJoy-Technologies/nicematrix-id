# Dev-features flag: ONE value for both stages. The builder bakes it into the
# console / account / experience bundles (Vite, compile time); the app stage
# exposes it to core at runtime (EnvSet.values.isDevFeaturesEnabled). Upstream
# only sets it in the builder, which left core with dev features OFF while the
# console showed dev UIs → e.g. user details `GET /api/users/:id/trusted-devices`
# 404 "Not Found". Both sides must always agree. NiceMatrix runs with it ON.
ARG dev_features_enabled=true

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

# 3) NiceMatrix-owned connectors (plain ESM, no build step). Installed AFTER the
#    production reinstall below, straight into packages/core/connectors, so their
#    imports (@logto/connector-kit, zod) resolve from packages/core/node_modules and
#    upstream's frozen pnpm lockfile stays untouched.
COPY logto-custom/connectors/ /tmp/nmx-connectors/

# Frontend side of the dev-features flag (value from the global ARG above).
ARG dev_features_enabled
ENV DEV_FEATURES_ENABLED=${dev_features_enabled}

ARG applicationinsights_connection_string
ENV APPLICATIONINSIGHTS_CONNECTION_STRING=${applicationinsights_connection_string}

ARG additional_connector_args
ENV ADDITIONAL_CONNECTOR_ARGS=${additional_connector_args}

# Console build is heavy (Vite + many circular chunks).
# Default Node heap (~4GB) OOMs on hosts with little headroom; raise to 6GB.
ENV NODE_OPTIONS="--max-old-space-size=6144"

RUN pnpm i
RUN pnpm -r build
RUN pnpm cli connector link $ADDITIONAL_CONNECTOR_ARGS -p .

RUN rm -rf node_modules packages/**/node_modules
RUN NODE_ENV=production pnpm i
RUN cp -R /tmp/nmx-connectors/connector-carrier packages/core/connectors/connector-carrier \
 && test -f packages/core/connectors/connector-carrier/lib/index.js
RUN rm -rf .scripts pnpm-*.yaml packages/cloud

###### [STAGE] Seal ######
FROM node:22-alpine as app
# Runtime side of the dev-features flag — must equal the builder's value.
ARG dev_features_enabled
ENV DEV_FEATURES_ENABLED=${dev_features_enabled}
WORKDIR /etc/logto
COPY --from=builder /etc/logto .
RUN mkdir -p /etc/logto/packages/cli/alteration-scripts && chmod g+w /etc/logto/packages/cli/alteration-scripts
EXPOSE 3001
ENTRYPOINT ["npm", "run"]
CMD ["start"]
