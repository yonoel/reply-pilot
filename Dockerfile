FROM node:22-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
  && npm install -g @larksuite/cli@1.0.40 \
  && npm cache clean --force

COPY src ./src
COPY README.md ./

RUN mkdir -p /app/.reply-pilot /home/node/.lark-cli \
  && chown -R node:node /app /home/node/.lark-cli

USER node

CMD ["npm", "start"]
