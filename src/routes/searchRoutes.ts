import { Router } from 'express';
import * as searchController from '@controllers/searchController';
import { protect } from '@middlewares/auth';
import { validateQuery } from '@validators/validate';
import { searchQuerySchema } from '@validators/searchValidators';

const router = Router();

// GET /v1/search?type=products|videos|users&q=
router.get('/', protect, validateQuery(searchQuerySchema), searchController.search);

export default router;
