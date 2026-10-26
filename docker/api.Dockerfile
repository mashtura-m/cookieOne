# API server (also serves the embeddable cmp.js)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/banner/package.json packages/banner/
COPY apps/api/package.json apps/api/
COPY apps/scanner/package.json apps/scanner/
COPY apps/dashboard/package.json apps/dashboard/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
COPY scripts scripts
COPY packages packages
COPY apps/api apps/api
RUN npm run build -w @consentflow/banner && npm run build -w @consentflow/api

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/banner/package.json packages/banner/
COPY apps/api/package.json apps/api/
COPY apps/scanner/package.json apps/scanner/
COPY apps/dashboard/package.json apps/dashboard/
RUN PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --omit=dev -w @consentflow/api --no-audit --no-fund
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/banner/dist packages/banner/dist
COPY db db
EXPOSE 4000
CMD ["node", "apps/api/dist/index.js"]
