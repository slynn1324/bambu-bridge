FROM node:lts-alpine

WORKDIR /app
COPY . .
RUN npm install

CMD ["node", "bambu-bridge.js"]
