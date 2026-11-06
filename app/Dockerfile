# -----------------------------------------------------------------------------
# Imagen de producción endurecida
#  - Multi-stage: las herramientas de build (npm, shell) NO llegan a producción.
#  - Runtime distroless: sin shell, sin gestor de paquetes -> superficie de ataque mínima.
#  - Bases fijadas por digest: build reproducible e inmune a re-etiquetados maliciosos
#    (Dependabot propone las actualizaciones de digest vía PR).
#  - Sin directiva "# syntax=": no se descarga un frontend de BuildKit no fijado.
#  - Usuario no root (65532) y código propiedad de root: el proceso no puede modificarse.
# -----------------------------------------------------------------------------
# ---------- Etapa 1: dependencias de producción ----------
FROM node:24-trixie-slim@sha256:0820eaa85e07d0490446dd01d14707e17e6108a36988cf374899cd057eb3812d AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# --omit=dev: Biome y demás herramientas de desarrollo no entran en la imagen.
# --ignore-scripts: bloquea scripts postinstall (vector de malware en npm).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && mkdir -p node_modules
COPY src ./src

# ---------- Etapa 2: runtime ----------
FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:b8cec4b2f2126ff7bd034ec9ac207ffb3272667dfdc48376e3b035d3270549ba AS runtime

ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
ARG BUILD_RUN_URL=""
ARG IMAGE_REF=unknown
ARG GIT_REPOSITORY=Danielperdomo29/devsecops-gitops-challenge
ARG APP_VERSION=1.0.0

LABEL org.opencontainers.image.title="devsecops-api" \
      org.opencontainers.image.description="API de referencia para el pipeline DevSecOps + GitOps" \
      org.opencontainers.image.authors="Daniel Enrique Perdomo Carvajal" \
      org.opencontainers.image.source="https://github.com/${GIT_REPOSITORY}" \
      org.opencontainers.image.revision="${GIT_SHA}" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.licenses="MIT"

ENV NODE_ENV=production \
    PORT=8080 \
    GIT_SHA=${GIT_SHA} \
    BUILD_DATE=${BUILD_DATE} \
    BUILD_RUN_URL=${BUILD_RUN_URL} \
    IMAGE_REF=${IMAGE_REF} \
    GIT_REPOSITORY=${GIT_REPOSITORY} \
    APP_VERSION=${APP_VERSION}

WORKDIR /app
# Archivos propiedad de root (0644/0755): el usuario 65532 puede leerlos pero no modificarlos.
COPY --from=build --chown=0:0 /app/node_modules ./node_modules
COPY --from=build --chown=0:0 /app/package.json ./package.json
COPY --from=build --chown=0:0 /app/src ./src

USER 65532:65532
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "/app/src/healthcheck.js"]

# La imagen distroless/nodejs ya usa "node" como ENTRYPOINT.
CMD ["/app/src/index.js"]
