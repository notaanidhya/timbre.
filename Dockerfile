FROM node:22-slim

WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy API backend source
COPY api/ ./api/

# Google Cloud Run injects PORT (default 8080)
ENV PORT=8080
EXPOSE 8080

CMD ["node", "api/dev_server.mjs"]
