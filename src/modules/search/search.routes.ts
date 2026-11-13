import { Router } from 'express';
import { SearchController } from './search.controller';
import { authenticate } from '../../core/middleware/auth.middleware';
import { validateQuery } from '../../core/middleware/zod.middleware';
import { searchQuerySchema } from './search.schema';

const router = Router();

// Search endpoint (protected by authentication with Zod query validation)
router.get('/', authenticate, validateQuery(searchQuerySchema), SearchController.search);

export const searchRoutes = router;
