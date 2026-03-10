FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY admin/package.json ./admin/
COPY shared/package.json ./shared/

RUN npm install --no-audit --no-fund --workspace=admin --workspace=shared --ignore-scripts

COPY shared/ ./shared/
COPY admin/ ./admin/

RUN npm run build -w admin

FROM nginx:alpine
COPY --from=build /app/admin/dist /usr/share/nginx/html

# SPA routing: unknown paths fall back to index.html
# PORT is injected by Railway; default to 80
RUN printf 'server {\n\
  listen %s;\n\
  root /usr/share/nginx/html;\n\
  index index.html;\n\
  location / {\n\
    try_files $uri $uri/ /index.html;\n\
  }\n\
}\n' "${PORT:-80}" > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["/bin/sh", "-c", "sed -i \"s/listen .*/listen ${PORT:-80};/\" /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
