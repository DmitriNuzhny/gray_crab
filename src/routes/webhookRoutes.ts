import express from 'express';
import crypto from 'crypto';
import { StoreService } from '../services/storeService';
import { env } from '../config/env';

const router = express.Router();
const storeService = new StoreService();

// Verify Shopify webhook signature
const verifyShopifyWebhook = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const hmac = req.get('X-Shopify-Hmac-SHA256');
  const topic = req.get('X-Shopify-Topic');
  const shop = req.get('X-Shopify-Shop-Domain');
  
  if (!hmac || !topic || !shop) {
    return res.status(401).json({ error: 'Missing required Shopify webhook headers' });
  }
  
  // Get the raw body as a buffer
  const rawBody = req.body;
  
  // Calculate HMAC
  const calculatedHmac = crypto
    .createHmac('sha256', env.shopifyWebhookSecret)
    .update(rawBody)
    .digest('base64');
  
  // Compare HMACs
  if (calculatedHmac !== hmac) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }
  
  // Add shop domain to request for later use
  (req as any).shopifyShop = shop;
  
  next();
};

// Handle product creation webhook
router.post('/product-created', verifyShopifyWebhook, async (req, res) => {
  try {
    const productId = req.body.id;
    
    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }
    
    console.log(`Webhook received: Product created with ID ${productId}`);
    
    // Use the full product ID directly
    await storeService.updateProductSalesChannels(productId, [
      'Google & YouTube',
      'TikTok'
    ]);
    
    console.log(`Successfully added product ${productId} to Google & YouTube and TikTok sales channels`);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error processing product creation webhook:', error);
    res.status(500).json({ 
      error: 'Failed to process webhook',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router; 