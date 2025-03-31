import express from 'express';
import { ProductController } from '../controllers/productController';

const router = express.Router();
const productController = new ProductController();

// GET endpoints
router.get('/sales-channels', productController.getAllSalesChannels.bind(productController));
router.get('/products-missing-channels', productController.getProductsMissingChannels.bind(productController));
router.get('/products-with-google-youtube-missing-attributes', productController.getProductsWithGoogleYouTubeErrors.bind(productController));

// Add redirect from old URL to new URL for backward compatibility
router.get('/products-with-google-errors', (req, res) => {
  res.redirect('products-with-google-youtube-missing-attributes');
});

// Add redirect from previously updated URL to newest URL for backward compatibility
router.get('/products-with-google-missing-attributes', (req, res) => {
  res.redirect('products-with-google-youtube-missing-attributes');
});

router.get('/', productController.getAllProducts.bind(productController));

// POST endpoints
router.post('/bulk-update-sales-channels', productController.bulkUpdateSalesChannels.bind(productController));
router.post('/bulk-update-sales-channels-by-ids', productController.bulkUpdateSalesChannelsByIds.bind(productController));
router.post('/bulk-update-google-attributes', productController.bulkUpdateGoogleAttributes.bind(productController));
router.post('/:id/sales-channels', productController.updateProductSalesChannels.bind(productController));

// Put the catch-all ID route last to avoid conflicts with other routes
router.get('/:id', productController.getProduct.bind(productController));

export default router; 