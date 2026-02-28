# Custom Logto image for NiceMatrix
# Based on official Logto with username validation patch
#
# Pin to specific version to ensure patch compatibility.
# When upgrading, test that patches/username-regex.js still applies cleanly.
FROM svhd/logto:1.36.0

# Install brotli for compressing patched JS bundles
RUN apk add --no-cache brotli

# Copy and apply patches
COPY patches/ /tmp/patches/
RUN node /tmp/patches/username-regex.js && \
    node /tmp/patches/console-branding.js && \
    node /tmp/patches/server-rotation.js && \
    rm -rf /tmp/patches/
