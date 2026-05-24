import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../lib/route-helpers.js';
import { ok } from '../lib/api-response.js';
import { ValidationError } from '../errors/index.js';
import { getPlaceDetails, searchPlaces } from '../services/places-service.js';

export const placesRouter = Router();
placesRouter.use(authenticate);

const SearchQuery = z.object({ q: z.string().min(1).max(200) });

placesRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    const parse = SearchQuery.safeParse(req.query);
    if (!parse.success) throw new ValidationError('invalid query', parse.error.flatten());
    const results = await searchPlaces(parse.data.q);
    ok(res, results);
  })
);

placesRouter.get(
  '/details/:placeId',
  asyncHandler(async (req, res) => {
    const placeId = req.params.placeId;
    if (!placeId || typeof placeId !== 'string') {
      throw new ValidationError('placeId is required');
    }
    const detail = await getPlaceDetails(placeId);
    ok(res, detail);
  })
);
