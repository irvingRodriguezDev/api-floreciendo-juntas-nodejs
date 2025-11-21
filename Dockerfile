# Usa Node 22 en Alpine (imagen base súper ligera)
FROM node:22-alpine

# Instala solo dependencias básicas (sin Chromium ni Puppeteer)
RUN apk update && \
    apk add --no-cache \
    ca-certificates \
    dumb-init && \
    rm -rf /var/cache/apk/*

# Variables de entorno
ENV NODE_ENV=production

# Crea el directorio de la app
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala solo las dependencias de producción
# Ya NO necesitas puppeteer aquí
RUN npm ci --omit=dev

# Copia el resto del código fuente
COPY . .

# Expone el puerto de tu API
EXPOSE 3000

# Usa dumb-init para gestión de procesos
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Comando para ejecutar tu API
CMD ["npm", "run", "start"]