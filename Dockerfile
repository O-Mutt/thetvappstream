FROM node:24-slim

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

EXPOSE 5000
CMD ["node", "app.js"]
