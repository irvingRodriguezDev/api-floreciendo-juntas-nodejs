# =========================
# 1️⃣ Builder
# =========================
FROM node:22-alpine3.19 AS builder

WORKDIR /app

# Dependencias solo para compilar módulos nativos
RUN apk update && apk add --no-cache \
    python3 \
    make \
    g++

# Copiamos manifests primero (mejor cache)
COPY package*.json ./

# Instalamos todas las dependencias
RUN npm ci

# Copiamos el código fuente
COPY . .

# Si hay build (TS, Prisma, etc.)
# RUN npm run build

# Dejamos solo dependencias de producción
RUN npm prune --omit=dev


# =========================
# 2️⃣ Runner (producción)
# =========================
FROM node:22-alpine3.19

ENV NODE_ENV=production

RUN apk update && apk add --no-cache \
    dumb-init \
    ca-certificates

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app ./

# Certificado para la base de datos
COPY certs/global-bundle.pem /certs/global-bundle.pem
RUN chmod 644 /certs/global-bundle.pem

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start"]