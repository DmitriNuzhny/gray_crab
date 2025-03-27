import { Router } from 'express';
import { ProductController } from '../controllers/productController';
import { requireApiKey } from '../middleware/auth';

const router = Router();
const productController = new ProductController();

// Public routes
router.get('/', productController.getAllProducts.bind(productController));
router.get('/:id', productController.getProduct.bind(productController));

// Protected admin routes
router.post('/', requireApiKey, productController.createProduct.bind(productController));
router.post('/bulk-update-sales-channels', requireApiKey, productController.bulkUpdateSalesChannels.bind(productController));

export default router; 