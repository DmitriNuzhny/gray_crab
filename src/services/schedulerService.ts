import { StoreService } from './storeService';
import { ProductService } from './productService';
import { env } from '../config/env';
import { UpdateResponse } from '../types/product';
import * as cron from 'node-cron';

export class SchedulerService {
  private storeService: StoreService;
  private productService: ProductService;
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning: boolean = false;

  constructor() {
    this.storeService = new StoreService();
    this.productService = new ProductService(this.storeService);
  }

  /**
   * Start the scheduler to fetch newly created products every 10 minutes
   */
  public startNewProductsScheduler(): void {
    if (this.cronJob) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('Starting scheduler to fetch newly created products every 10 minutes');
    
    // Run immediately on start
    this.processNewProducts().catch(error => {
      console.error('Error in initial run of new products scheduler:', error);
    });

    // Then schedule to run every 10 minutes using node-cron
    // Cron expression: "*/10 * * * *" means "every 10 minutes"
    this.cronJob = cron.schedule('*/10 * * * *', () => {
      this.processNewProducts().catch(error => {
        console.error('Error in scheduled run of new products scheduler:', error);
      });
    });
  }

  /**
   * Stop the scheduler
   */
  public stopScheduler(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      console.log('Scheduler stopped');
    }
  }

  /**
   * Process newly created products and update their sales channels
   */
  private async processNewProducts(): Promise<void> {
    if (this.isRunning) {
      console.log('Previous run is still in progress, skipping this run');
      return;
    }

    try {
      this.isRunning = true;
      console.log('Starting to process newly created products');

      // Get products created in the last 15 minutes (to ensure we don't miss any)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      const query = `
        query {
          products(first: 100, query: "created_at:>${fifteenMinutesAgo.toISOString()}") {
            edges {
              node {
                id
                title
                createdAt
              }
            }
          }
        }
      `;

      const response = await this.storeService.executeGraphQLQuery(
        query,
        3,
        30000
      );

      if (response.data.errors) {
        console.error('GraphQL errors when fetching new products:', JSON.stringify(response.data.errors));
        return;
      }

      const products = response.data.data.products.edges.map((edge: any) => edge.node);
      
      if (products.length === 0) {
        console.log('No new products found in the last 15 minutes');
        return;
      }

      console.log(`Found ${products.length} new products created in the last 15 minutes`);

      // Extract product IDs and ensure they're in the correct format
      const productIds = products.map((product: any) => {
        // Check if the ID already has the gid://shopify/Product/ prefix
        if (product.id.startsWith('gid://shopify/Product/')) {
          return product.id;
        } else {
          // If not, add the prefix
          return `gid://shopify/Product/${product.id}`;
        }
      });

      // Update sales channels for these products
      const salesChannels = ['Google & YouTube', 'TikTok'];
      
      console.log(`Updating sales channels for ${productIds.length} products to: ${salesChannels.join(', ')}`);
      
      const result = await this.productService.bulkUpdateSalesChannels({
        productIds,
        salesChannels
      });

      console.log(`Successfully updated ${result.updatedProducts?.length || 0} products`);
      
      if (result.failedProducts && result.failedProducts.length > 0) {
        console.warn(`Failed to update ${result.failedProducts.length} products`);
        console.warn('Failed product IDs:', result.failedProducts);
        
        // Check if productErrors exists on the result
        if ('productErrors' in result) {
          console.warn('Error messages:', (result as any).productErrors);
        }
      }

    } catch (error) {
      console.error('Error processing new products:', error);
    } finally {
      this.isRunning = false;
    }
  }
} 