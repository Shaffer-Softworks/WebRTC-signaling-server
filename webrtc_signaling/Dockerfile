ARG BUILD_FROM=node:20-alpine
FROM $BUILD_FROM

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .
EXPOSE 8765

CMD ["node", "server.js"]
