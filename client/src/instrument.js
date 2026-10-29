// Imported first in main.jsx, before React/App — initializes Sentry before anything
// else runs so it can catch errors from the very first render.
import * as Sentry from '@sentry/react';
import { useEffect } from 'react';
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from 'react-router-dom';

const dsn = import.meta.env.VITE_SENTRY_DSN;

Sentry.init({
  dsn,
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.reactRouterV7BrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
  ],
  // Page-load/navigation span timing. Lower this in .env if traffic volume ever
  // makes 100% sampling expensive against your Sentry quota.
  tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? 1.0),
  enabled: Boolean(dsn),
});
