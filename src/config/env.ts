import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Validate required environment variables
const requiredEnvVars = ['SHOPIFY_STORE_ADMIN_API_URL', 'SHOPIFY_STORE_ACCESS_TOKEN', 'SHOPIFY_STORE_NAME'] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is not set`);
  }
}

export const env = {
  port: process.env.PORT || 3000,
  storeApiUrl: process.env.SHOPIFY_STORE_ADMIN_API_URL || '',
  storeApiKey: process.env.SHOPIFY_STORE_ACCESS_TOKEN || '',
  shopifyStore: process.env.SHOPIFY_STORE_NAME || '',
  shopifyWebhookSecret: process.env.SHOPIFY_STORE_WEBHOOK_SECRET || '',
}; 