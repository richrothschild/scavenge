FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build -w admin

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/admin/dist ./dist
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
