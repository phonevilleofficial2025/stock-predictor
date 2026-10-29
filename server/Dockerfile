FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

ENV PORT=4000
EXPOSE 4000

VOLUME ["/app/data"]

CMD ["node", "--import", "./src/instrument.js", "src/index.js"]
