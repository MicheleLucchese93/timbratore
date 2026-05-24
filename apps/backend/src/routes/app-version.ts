import { Router } from 'express';
import { ok } from '../lib/api-response.js';

export const appVersionRouter = Router();

appVersionRouter.get('/', (_req, res) => {
  ok(res, {
    ios: { min_version: '1.0.0', latest_version: '1.0.0', force_upgrade: false },
    android: { min_version: '1.0.0', latest_version: '1.0.0', force_upgrade: false },
  });
});
