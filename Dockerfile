FROM node:24-alpine
WORKDIR /app
RUN apk add --no-cache ffmpeg python3 py3-numpy py3-pillow
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY apps/api/*.mjs ./apps/api/
COPY apps/api/data/official-assets.json ./apps/api/data/official-assets.json
COPY apps/web ./apps/web
COPY packages ./packages
COPY scripts ./scripts
RUN mkdir -p /data /app/apps/web/assets/pals/ugc && chown -R node:node /data /app/apps/web/assets/pals/ugc
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173 PYTHON=python3 \
    GALLERY_STATE_PATH=/data/gallery.json TOKEN_STATE_PATH=/data/player-wallet.json \
    CONFIRMED_PALS_PATH=/data/confirmed-pals.json PAL_RESOURCE_STATE_PATH=/data/pal-resource-tasks.json \
    PARTNER_SESSIONS_PATH=/data/partner-sessions.json
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(async r=>{const h=await r.json();if(!r.ok||!h.ok||h.debugEnabled)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/api/server.mjs"]
