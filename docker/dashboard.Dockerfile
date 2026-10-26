# Dashboard: static build served by nginx
FROM node:22-slim AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:4000
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/banner/package.json packages/banner/
COPY apps/api/package.json apps/api/
COPY apps/scanner/package.json apps/scanner/
COPY apps/dashboard/package.json apps/dashboard/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY packages packages
COPY apps/dashboard apps/dashboard
RUN npm run build -w @consentflow/dashboard

FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
EXPOSE 80
