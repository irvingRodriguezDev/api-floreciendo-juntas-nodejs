# --- STAGE 1: Build & Dependencies ---
FROM node:22-alpine AS builder

WORKDIR /app

# Instalamos dependencias necesarias para compilar (si hubiera nativas)
# Alpine es muy ligero, a veces necesita build-base para ciertos paquetes
RUN apk add --no-cache python3 make g++

COPY package*.json ./

# Instalamos TODAS las dependencias para poder construir/preparar si fuera necesario
# Usamos ci para asegurar versiones exactas
RUN npm ci

COPY . .

# Eliminamos dependencias de desarrollo y limpiamos caché de npm para dejar solo lo vital
RUN npm prune --production && npm cache clean --force


# --- STAGE 2: Production Runtime (La imagen final) ---
FROM node:22-alpine AS runner

# Instalamos solo lo mínimo para la ejecución
RUN apk add --no-cache dumb-init ca-certificates

WORKDIR /app
ENV NODE_ENV=production

# Copiamos solo los node_modules ya filtrados del stage anterior
COPY --from=builder /app/node_modules ./node_modules
# Copiamos el código fuente
COPY --from=builder /app .

# Aseguramos el certificado en su ruta (puedes copiarlo desde el builder si ya estaba ahí)
COPY certs/global-bundle.pem /certs/global-bundle.pem

EXPOSE 3000

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]