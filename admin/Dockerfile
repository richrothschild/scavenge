FROM node:20-alpine AS build
WORKDIR /app

# Copy only what's needed to build the admin SPA
COPY package.json package-lock.json ./
COPY admin/package.json ./admin/
COPY shared/package.json ./shared/

RUN npm install --no-audit --no-fund --workspace=admin --workspace=shared --ignore-scripts

COPY shared/ ./shared/
COPY admin/ ./admin/

RUN npm run build -w admin

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve

COPY --from=build /app/admin/dist ./dist
EXPOSE 3000
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
