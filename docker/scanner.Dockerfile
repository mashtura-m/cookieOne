# Scanner worker. The Playwright image ships Chromium and its system dependencies.
FROM mcr.microsoft.com/playwright:v1.63.0-noble
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
COPY apps/scanner apps/scanner
RUN npm run build -w @consentflow/scanner
ENV NODE_ENV=production
CMD ["node", "apps/scanner/dist/index.js"]
