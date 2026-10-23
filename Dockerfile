FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server ./server
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node dist ./dist
COPY --chown=node:node package.json ./
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups
ENV HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server/start.mjs"]
