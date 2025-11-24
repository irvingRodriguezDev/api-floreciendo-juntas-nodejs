# Usa Node 22 en Alpine
FROM node:22-alpine

# Instala dumb-init y certificados
RUN apk add --no-cache \
    dumb-init \
    ca-certificates

ENV NODE_ENV=production

# Crea el directorio de la app
WORKDIR /app

# Copia dependencias
COPY package*.json ./

# Instala solo dependencias de producción
RUN npm ci --omit=dev

# Copia el resto del código fuente
COPY . .

# Expone el puerto
EXPOSE 3000

# Usa dumb-init instalado en la imagen
ENTRYPOINT ["dumb-init", "--"]

# Ejecuta la API
CMD ["npm", "run", "start"]
