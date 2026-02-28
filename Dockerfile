FROM svhd/logto:1.37.0
RUN apk add --no-cache brotli
COPY patches/ /tmp/patches/
RUN node /tmp/patches/console-branding.js && \
    rm -rf /tmp/patches/
