import cors from 'cors';
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import { fileURLToPath } from 'url';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './modules/taxi/middlewares/errorMiddleware.js';
import { securityHeaders } from './modules/taxi/middlewares/securityHeadersMiddleware.js';
import { taxiRouter } from './modules/taxi/routes/index.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(securityHeaders);

  // Only our own websites may read API responses from a browser (CORS_ORIGIN,
  // the same list the socket uses). The mobile apps send no Origin and are not
  // affected. '*' remains only when nothing is configured, i.e. local dev.
  app.use(
    cors({
      origin: env.corsOrigin === '*' ? '*' : env.corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean),
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true })); 
  app.use(morgan(env.nodeEnv === 'production' ? 'combined' : 'dev'));

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

  app.get('/health', (_req, res) => {
    res.json({ success: true, message: 'Taxi backend is healthy' });
  });

  // Keep both mounts during integration so existing clients using /api or /api/v1 continue to work.
  app.use('/api', taxiRouter);
  app.use('/api/v1', taxiRouter);

  app.get(['/api', '/api/v1'], (_req, res) => {
    res.json({ success: true, message: 'API is running' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
