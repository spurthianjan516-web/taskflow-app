# ══════════════════════════════════════════════
# STAGE 1: builder
# WHY: Install ALL deps + copy code
#      This stage is DISCARDED in final image
# ══════════════════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files FIRST
# WHY: Docker layer caching — if package.json unchanged,
#      npm ci is skipped on next build (saves minutes!)
COPY package*.json ./

# Install all dependencies (including devDeps for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# ══════════════════════════════════════════════
# STAGE 2: production
# WHY: Final image — only what's needed to RUN
#      No devDependencies, no build tools
#      Result: smaller, faster, more secure image
# ══════════════════════════════════════════════
FROM node:20-alpine AS production

# Build metadata labels
ARG BUILD_DATE
ARG GIT_COMMIT
ARG VERSION
LABEL org.opencontainers.image.created="${BUILD_DATE}"
LABEL org.opencontainers.image.revision="${GIT_COMMIT}"
LABEL org.opencontainers.image.version="${VERSION}"
LABEL org.opencontainers.image.title="taskflow-app"

# Security: create non-root user
# WHY: Running as root inside container = security risk
#      If app is compromised, attacker gets root on host
RUN addgroup -S taskgroup && \
    adduser  -S taskuser -G taskgroup

WORKDIR /app

# Install ONLY production dependencies
COPY package*.json ./
RUN npm ci --only=production && \
    npm cache clean --force

# Copy source from builder stage
COPY --from=builder --chown=taskuser:taskgroup /app/src ./src

# Set correct ownership
RUN chown -R taskuser:taskgroup /app

# Switch to non-root user
USER taskuser

# Document which port app uses
EXPOSE 3000

# Health check
# WHY: Docker + K8s use this to know if container is healthy
#      3 failures in a row → container marked unhealthy → restart
HEALTHCHECK --interval=30s \
            --timeout=10s  \
            --start-period=10s \
            --retries=3 \
  CMD wget --no-verbose --tries=1 \
      --spider http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
