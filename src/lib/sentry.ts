import * as Sentry from '@sentry/node'
import type { Application } from 'express'

export function initSentry(): void {
  if (process.env.NODE_ENV !== 'production') return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return

  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development'
  const tracesSampleRate = Number.isFinite(Number(process.env.SENTRY_TRACES_SAMPLE_RATE))
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : process.env.NODE_ENV === 'production'
      ? 0.1
      : 0

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate,
  })

  console.log('[Sentry] Initialized')
}

export function setupSentryErrorHandler(app: Application): void {
  if (process.env.NODE_ENV !== 'production') return
  const dsn = process.env.SENTRY_DSN
  if (!dsn) return
  Sentry.setupExpressErrorHandler(app)
}

export { Sentry }
