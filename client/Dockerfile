# --- Stage: build static assets ---
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
# Public key, baked into the built JS at build time (Vite inlines VITE_* vars) —
# unlike TURNSTILE_SECRET_KEY, this one is meant to ship to the browser.
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY
# Sentry DSNs are public identifiers by design (safe to ship to the browser), not
# secrets — same build-time-bake pattern as the Turnstile site key above.
ARG VITE_SENTRY_DSN
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ENV VITE_SENTRY_TRACES_SAMPLE_RATE=$VITE_SENTRY_TRACES_SAMPLE_RATE
RUN npm run build

# --- Stage: serve with nginx ---
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
