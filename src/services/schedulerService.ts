import { StoreService } from './storeService';
import { ProductService } from './productService';
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
   * Start the scheduler to fetch newly created products every 30 minutes
   */
  public startNewProductsScheduler(): void {
    if (this.cronJob) {
      console.log('Scheduler is already running');
      return;
    }

    console.log('Starting scheduler to fetch the last 150 products every 30 minutes');
    
    // Run immediately on start
    this.processNewProducts().catch(error => {
      console.error('Error in initial run of new products scheduler:', error);
    });

    // Then schedule to run every 30 minutes using node-cron
    // Cron expression: "*/30 * * * *" means "every 30 minutes"
    this.cronJob = cron.schedule('*/30 * * * *', () => {
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

      // Get the last 150 products sorted by creation date
      const query = `
        query {
          products(first: 150, sortKey: CREATED_AT, reverse: true) {
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

      console.log('Executing GraphQL query to fetch the last 150 products...');
      const response = await this.storeService.executeGraphQLQuery(
        query,
        3,
        30000
      );

      if (response.data.errors) {
        console.error('GraphQL errors when fetching products:', JSON.stringify(response.data.errors));
        return;
      }

      const products = response.data.data.products.edges.map((edge: any) => edge.node);
      
      if (products.length === 0) {
        console.log('No products found');
        return;
      }

      console.log(`Found ${products.length} products`);
      
      // Log the creation times of the first few products
      if (products.length > 0) {
        console.log('Sample of product creation times:');
        products.slice(0, 5).forEach((product: any, index: number) => {
          console.log(`Product ${index + 1}: ${product.title} - Created at: ${product.createdAt}`);
        });
      }

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
      const salesChannels = ['Online Store', 'Google & YouTube', 'TikTok'];
      
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
      console.error('Error processing products:', error);
    } finally {
      this.isRunning = false;
    }
  }
} 