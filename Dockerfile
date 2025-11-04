FROM node:22.21.1-alpine3.21
##/app
#cd app
WORKDIR /app
#copiar los archivos
COPY src package.json ./
#instalar las dependencias
RUN npm install

CMD ["npm", "run", "dev"]

