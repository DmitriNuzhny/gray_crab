import { Router } from 'express';
import { ProductController } from '../controllers/productController';

const router = Router();
const productController = new ProductController();

router.get('/', productController.getAllProducts.bind(productController));
router.get('/:id', productController.getProduct.bind(productController));
router.get('/sales-channels', productController.getAllSalesChannels.bind(productController));
router.post('/bulk-update-sales-channels', productController.bulkUpdateSalesChannels.bind(productController));

export default router; 