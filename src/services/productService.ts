import { Product, BulkUpdateRequest, UpdateResponse } from '../types/product';
import { StoreService } from './storeService';

export class ProductService {
  private storeService: StoreService;

  constructor(storeService: StoreService) {
    this.storeService = storeService;
  }

  async getAllSalesChannels(): Promise<string[]> {
    return this.storeService.getAllSalesChannels();
  }

  async bulkUpdateSalesChannels(request: BulkUpdateRequest): Promise<UpdateResponse> {
    const { productIds, salesChannels } = request;
    const updatedProducts: string[] = [];
    const failedProducts: string[] = [];
    // Map to store error messages for each failed product
    const productErrors = new Map<string, string>();
    
    // Use smaller batch size for better throttling
    const batchSize = 10;
    
    // Start with low concurrency to avoid rate limits
    let maxConcurrent = 2;
    
    // Track consecutive successes/failures to adapt our approach
    let consecutiveSuccesses = 0;
    let consecutiveFailures = 0;
    let lastBatchSuccessRate = 1.0; // Start optimistic
    
    // Get total batches for progress reporting
    const totalBatches = Math.ceil(productIds.length / batchSize);
    
    // Process products in batches
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batchIndex = Math.floor(i / batchSize) + 1;
      console.log(`Processing batch ${batchIndex} of ${totalBatches} (${Math.round((batchIndex/totalBatches)*100)}% complete)`);
      
      // Adjust concurrency based on performance
      if (consecutiveFailures >= 2) {
        // If we've had multiple failures, reduce concurrency
        maxConcurrent = Math.max(1, maxConcurrent - 1);
        console.log(`⚠️ Reducing concurrency to ${maxConcurrent} due to consecutive failures`);
        // Reset counter after adjusting
        consecutiveFailures = 0;
        // Add extra backoff
        console.log(`Adding extra backoff period of 5 seconds`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      } else if (consecutiveSuccesses >= 3 && lastBatchSuccessRate > 0.9 && maxConcurrent < 3) {
        // If we're doing well, cautiously increase concurrency
        maxConcurrent += 1;
        console.log(`✅ Increasing concurrency to ${maxConcurrent} after sustained success`);
        consecutiveSuccesses = 0;
      }
      
      const batch = productIds.slice(i, i + batchSize);
      
      // Process in smaller concurrent chunks to avoid rate limits
      let batchSuccesses = 0;
      let batchFailures = 0;
      
      for (let j = 0; j < batch.length; j += maxConcurrent) {
        const concurrentBatch = batch.slice(j, j + maxConcurrent);
        
        console.log(`Processing concurrent batch ${Math.floor(j/maxConcurrent) + 1} of ${Math.ceil(batch.length/maxConcurrent)} in batch ${batchIndex}`);
        
        const updatePromises = concurrentBatch.map(async (productId) => {
          try {
            await this.storeService.updateProductSalesChannels(productId, salesChannels);
            return { success: true, id: productId };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Failed to update product ${productId}: ${errorMessage}`);
            
            // Check if we hit throttling limits
            if (errorMessage.includes('Throttled') || errorMessage.includes('THROTTLED')) {
              console.log(`🛑 Throttling detected, will add extra delay after this batch`);
            }
            
            return { success: false, id: productId, error: errorMessage };
          }
        });

        const results = await Promise.all(updatePromises);
        
        // Count successes and failures for this batch
        let subBatchSuccesses = 0;
        let subBatchFailures = 0;
        
        results.forEach(result => {
          if (result.success) {
            updatedProducts.push(result.id);
            subBatchSuccesses++;
            batchSuccesses++;
          } else {
            failedProducts.push(result.id);
            // Store the error message for this product
            productErrors.set(result.id, result.error || 'Unknown error');
            subBatchFailures++;
            batchFailures++;
            
            // If we have throttling errors, need to be more conservative
            if (productErrors.get(result.id)?.includes('Throttled') || 
                productErrors.get(result.id)?.includes('THROTTLED')) {
              consecutiveFailures++;
            }
          }
        });
        
        // Calculate success rate for this sub-batch
        const subBatchTotal = subBatchSuccesses + subBatchFailures;
        const subBatchSuccessRate = subBatchTotal > 0 ? subBatchSuccesses / subBatchTotal : 0;
        
        console.log(`Concurrent batch complete: ${subBatchSuccesses} successes, ${subBatchFailures} failures (${(subBatchSuccessRate * 100).toFixed(1)}% success rate)`);
        
        // Add a delay between concurrent batches to avoid rate limits - adaptive based on success rate
        if (j + maxConcurrent < batch.length) {
          let delayMs = 1000; // Base delay
          
          // If the success rate is low, add more delay
          if (subBatchSuccessRate < 0.5) {
            delayMs = 5000; // Longer delay for poor success rates
            console.log(`⚠️ Low success rate detected (${(subBatchSuccessRate * 100).toFixed(1)}%), adding extra delay of ${delayMs}ms`);
          } else if (subBatchSuccessRate < 1.0) {
            delayMs = 2000; // Medium delay for partial success
            console.log(`⚠️ Partial success rate detected (${(subBatchSuccessRate * 100).toFixed(1)}%), adding delay of ${delayMs}ms`);
          } else {
            console.log(`Adding standard delay between concurrent batches: ${delayMs}ms`);
          }
          
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
      
      // Calculate success rate for this batch
      const batchTotal = batchSuccesses + batchFailures;
      lastBatchSuccessRate = batchTotal > 0 ? batchSuccesses / batchTotal : 0;
      
      console.log(`Batch ${batchIndex} complete: ${batchSuccesses} successes, ${batchFailures} failures (${(lastBatchSuccessRate * 100).toFixed(1)}% success rate)`);
      console.log(`Overall progress: ${updatedProducts.length + failedProducts.length}/${productIds.length} products processed`);
      
      // Update consecutive success/failure counters
      if (lastBatchSuccessRate === 1.0) {
        consecutiveSuccesses++;
        consecutiveFailures = 0;
      } else if (lastBatchSuccessRate < 0.5) {
        consecutiveFailures++;
        consecutiveSuccesses = 0;
      }
      
      // Add a delay between batches to avoid hitting rate limits - adaptive based on batch success
      if (i + batchSize < productIds.length) {
        let delayMs = 2000; // Base delay between batches
        
        if (lastBatchSuccessRate < 0.5) {
          // If we had a poor success rate, add a much longer delay
          delayMs = 10000;
          console.log(`⚠️ Poor batch success rate (${(lastBatchSuccessRate * 100).toFixed(1)}%), adding extended delay of ${delayMs}ms between batches`);
        } else if (lastBatchSuccessRate < 0.9) {
          // If we had some failures, add a longer delay
          delayMs = 5000;
          console.log(`⚠️ Some failures in batch (${(lastBatchSuccessRate * 100).toFixed(1)}%), adding longer delay of ${delayMs}ms between batches`);
        } else {
          console.log(`Adding standard delay between batches: ${delayMs}ms`);
        }
        
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }

    // Create a summary of errors if products failed
    let errorSummary = '';
    if (failedProducts.length > 0) {
      // Group by error message
      const errorMap = new Map<string, number>();
      failedProducts.forEach(id => {
        const errorMsg = productErrors.get(id) || 'Unknown error';
        errorMap.set(errorMsg, (errorMap.get(errorMsg) || 0) + 1);
      });
      
      errorSummary = 'Error summary:\n' + 
        Array.from(errorMap.entries())
          .map(([error, count]) => `- ${error}: ${count} products`)
          .join('\n');
      
      console.error(errorSummary);
    }

    return {
      success: failedProducts.length === 0,
      message: failedProducts.length === 0 
        ? 'All products updated successfully' 
        : `Updated ${updatedProducts.length} products, ${failedProducts.length} products failed. ${errorSummary}`,
      updatedProducts,
      failedProducts
    };
  }

  async getProduct(id: string): Promise<Product | null> {
    return this.storeService.getProduct(id);
  }

  async getAllProducts(): Promise<Product[]> {
    const productIds = await this.storeService.getAllProducts();
    const products: Product[] = [];
    
    // Fetch full product details for each ID
    for (const id of productIds) {
      const product = await this.storeService.getProduct(id);
      if (product) {
        products.push(product);
      }
    }
    
    return products;
  }

  async createProduct(product: Product): Promise<Product> {
    // Implement product creation logic here
    throw new Error('Method not implemented');
  }

  async getProductsMissingChannels(): Promise<string[]> {
    return this.storeService.getProductsMissingChannels();
  }
} 