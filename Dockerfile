FROM node:24-slim

WORKDIR /usr/src/app

COPY package*.json ./
# Install deps, then the Chromium build Playwright needs for the DaddyLive
# headless solver (with its OS libraries). Sources that don't use the solver
# (thetvapp) never launch it, but the binary must be present for those that do.
RUN npm install --omit=dev --no-audit --no-fund \
  && apt-get update \
  && npx playwright install --with-deps chromium \
  && rm -rf /var/lib/apt/lists/* \
  && npm cache clean --force

COPY . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "app.js"]
