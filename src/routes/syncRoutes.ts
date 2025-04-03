import { Router } from 'express';
import { syncProducts } from '../controllers/syncController';

const router = Router();

router.post('/sync', syncProducts);

export default router; 