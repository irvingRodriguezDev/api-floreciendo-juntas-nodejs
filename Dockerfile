# Usa Node 22 en Alpine (compatible con Graviton ARM64)
FROM node:22-alpine

# Instala Chromium y dependencias necesarias para Puppeteer en Alpine
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
    dumb-init

# Variables de entorno para Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

# Crea el directorio de la app
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala solo las dependencias de producción
RUN npm ci --omit=dev

# Copia el resto del código fuente
COPY src ./

# Expone el puerto
EXPOSE 3000

# Usa dumb-init para evitar problemas con señales en contenedores
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Comando para ejecutar tu API
CMD ["npm", "run", "dev"]
