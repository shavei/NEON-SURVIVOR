# NEON SURVIVOR — authoritative game server image (Fly.io).
# Dependency-free: the server (server/*.js) and the sim layer it loads (js/config-sim,core,world,sim)
# use only Node built-ins, so there is NO npm install step — the image is just Node + the source.
FROM node:22-alpine
WORKDIR /app

# The server reads the sim files relative to the repo root (server/.. -> /app), so ship js/ + server/.
COPY js ./js
COPY server ./server
COPY package.json ./

ENV NODE_ENV=production
# Render (and most PaaS) inject PORT at runtime; server/game-server.js reads process.env.PORT
# and falls back to 8787 for local runs. EXPOSE is informational only.
EXPOSE 8787

# server/game-server.js listens on $PORT, ticks each room's SimHost at 60 Hz, broadcasts snapshots.
CMD ["node", "server/game-server.js"]
