# Usa Node 22 en Alpine. Buildx seleccionará automáticamente la variante de Alpine para amd64 o arm64.
FROM node:22-alpine

# Instala Chromium y dependencias necesarias para Puppeteer en Alpine.
# Estos paquetes son esenciales para que Chromium se ejecute en el entorno contenedorizado.
RUN apk update && \
    apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji \
    dumb-init && \
    rm -rf /var/cache/apk/*

# Variables de entorno para Puppeteer.
# PUPPETEER_SKIP_DOWNLOAD: Evita que Puppeteer intente descargar Chromium (ya lo instalamos por apk).
# PUPPETEER_EXECUTABLE_PATH: Le indica a Puppeteer dónde encontrar el binario de Chromium instalado por apk.
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium-browser"
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV NODE_ENV=production

# Crea el directorio de la app
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala solo las dependencias de producción
# El flag --omit=dev es crucial para mantener la imagen pequeña.
RUN npm ci --omit=dev

# Copia el resto del código fuente (asume que tu app está en la carpeta 'src')
COPY . .
# Expone el puerto de tu API
EXPOSE 3000

# Usa dumb-init para evitar problemas de gestión de procesos/señales
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Comando para ejecutar tu API
# **ATENCIÓN:** Cambia 'dev' por 'start' si ese es el script de producción en tu package.json
CMD ["npm", "run", "start"]