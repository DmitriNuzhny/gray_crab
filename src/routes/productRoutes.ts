import express from 'express';
import { ProductController } from '../controllers/productController';

const router = express.Router();
const productController = new ProductController();

// GET endpoints
router.get('/sales-channels', productController.getAllSalesChannels.bind(productController));
router.get('/', productController.getAllProducts.bind(productController));
router.get('/:id', productController.getProduct.bind(productController));

// POST endpoints
router.post('/bulk-update-sales-channels', productController.bulkUpdateSalesChannels.bind(productController));
router.post('/bulk-update-sales-channels-by-ids', productController.bulkUpdateSalesChannelsByIds.bind(productController));
router.post('/:id/sales-channels', productController.updateProductSalesChannels.bind(productController));

export default router; 