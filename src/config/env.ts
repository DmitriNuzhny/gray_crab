import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Validate required environment variables
const requiredEnvVars = ['STORE_API_URL', 'STORE_API_KEY', 'SHOPIFY_STORE'] as const;

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is not set`);
  }
}

export const env = {
  port: process.env.PORT || 3000,
  storeApiUrl: process.env.STORE_API_URL || '',
  storeApiKey: process.env.STORE_API_KEY || '',
  shopifyStore: process.env.SHOPIFY_STORE || '',
  shopifyWebhookSecret: process.env.SHOPIFY_WEBHOOK_SECRET || '',
}; 