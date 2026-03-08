FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
COPY backend/package.json backend/package.json
COPY shared/package.json shared/package.json
COPY admin/package.json admin/package.json
COPY mobile/package.json mobile/package.json
RUN npm ci

COPY . .
RUN npm run build -w backend

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/seed-config.json ./seed-config.json

RUN npm ci --omit=dev --workspace=backend

EXPOSE 3001
CMD ["node", "backend/dist/index.js"]
