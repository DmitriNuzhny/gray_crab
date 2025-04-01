import { Product, BulkUpdateRequest, UpdateResponse, GoogleProductAttributes, GoogleAttributesBulkUpdateRequest } from '../types/product';
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

  async bulkUpdateGoogleAttributes(request: GoogleAttributesBulkUpdateRequest): Promise<UpdateResponse> {
    const { productIds, attributes } = request;
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
            await this.storeService.updateGoogleAttributes(productId, attributes);
            return { success: true, id: productId };
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Failed to update Google attributes for product ${productId}: ${errorMessage}`);
            
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
        : `Updated ${updatedProducts.length} products with Google attributes, ${failedProducts.length} products failed. ${errorSummary}`,
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

  async autoUpdateGoogleAttributes(productIds: string[]): Promise<{
    success: boolean;
    message: string;
    updatedProducts: string[];
    failedProducts: string[];
  }> {
    try {
      const updatedProducts: string[] = [];
      const failedProducts: string[] = [];
      const errorReasons = new Map<string, number>();
      
      // Process each product
      for (const productId of productIds) {
        try {
          // Get product details to analyze and determine attributes
          const product = await this.storeService.getProduct(productId);
          
          if (!product) {
            failedProducts.push(productId);
            this.incrementError(errorReasons, 'Product not found');
            continue;
          }
          
          // Auto-detect attributes based on product details
          const attributes = await this.detectGoogleAttributes(product);
          
          // Check if there are multiple variants or just the default variant
          const hasMultipleVariants = product.variants && 
                                     Array.isArray(product.variants) && 
                                     product.variants.length > 1;
          
          // Define product level attributes
          let productAttributes: GoogleProductAttributes;
          
          if (hasMultipleVariants) {
            // If product has multiple variants, only assign category at product level
            productAttributes = {
              category: attributes.category,
              color: '',
              size: '',
              gender: '',
              ageGroup: ''
            };
          } else {
            // If product has only one (default) variant, assign all attributes at product level
            productAttributes = attributes;
          }
          
          // If we couldn't determine the required category attribute, log and skip
          if (!productAttributes.category) {
            failedProducts.push(productId);
            this.incrementError(errorReasons, 'Could not determine product category');
            continue;
          }
          
          // Update the main product with the determined attributes
          await this.storeService.updateGoogleAttributes(productId, productAttributes);
          
          // For products with multiple variants, update each variant with specific attributes
          if (hasMultipleVariants && product.variants && product.variants.length > 0) {
            for (const variant of product.variants) {
              if (variant.id) {
                try {
                  // For variants, we set color, size, gender, ageGroup
                  const variantAttributes: GoogleProductAttributes = {
                    category: '', // Category is assigned at product level
                    color: attributes.color,
                    size: attributes.size,
                    gender: attributes.gender,
                    ageGroup: attributes.ageGroup
                  };
                  
                  // Extract attributes from variant options when possible
                  if (variant.option1 && typeof variant.option1 === 'string') {
                    const option1Lower = variant.option1.toLowerCase();
                    
                    // Check if option1 looks like a size
                    if (/^(xs|s|m|l|xl|xxl|xxxl|[0-9]+)$/i.test(option1Lower) || 
                        /^(small|medium|large|one size)$/i.test(option1Lower)) {
                      variantAttributes.size = this.normalizeSize(variant.option1);
                    } 
                    // Check if option1 looks like a color
                    else if (this.isColor(option1Lower)) {
                      variantAttributes.color = this.capitalizeFirstLetter(option1Lower);
                    }
                  }
                  
                  if (variant.option2 && typeof variant.option2 === 'string') {
                    const option2Lower = variant.option2.toLowerCase();
                    
                    // Check if option2 looks like a size
                    if (/^(xs|s|m|l|xl|xxl|xxxl|[0-9]+)$/i.test(option2Lower) || 
                        /^(small|medium|large|one size)$/i.test(option2Lower)) {
                      variantAttributes.size = this.normalizeSize(variant.option2);
                    } 
                    // Check if option2 looks like a color
                    else if (this.isColor(option2Lower)) {
                      variantAttributes.color = this.capitalizeFirstLetter(option2Lower);
                    }
                  }
                  
                  if (variant.option3 && typeof variant.option3 === 'string') {
                    const option3Lower = variant.option3.toLowerCase();
                    
                    // Check if option3 contains gender information
                    if (option3Lower.includes('men') || option3Lower.includes('women') || 
                        option3Lower.includes('male') || option3Lower.includes('female') || 
                        option3Lower.includes('unisex')) {
                      
                      if (option3Lower.includes('women') || option3Lower.includes('female')) {
                        variantAttributes.gender = 'Female';
                      } else if (option3Lower.includes('men') || option3Lower.includes('male')) {
                        variantAttributes.gender = 'Male';
                      } else if (option3Lower.includes('unisex')) {
                        variantAttributes.gender = 'Unisex';
                      }
                    }
                    
                    // Check if option3 contains age group information
                    if (option3Lower.includes('kid') || option3Lower.includes('child') || 
                        option3Lower.includes('teen') || option3Lower.includes('adult')) {
                      
                      if (option3Lower.includes('kid') || option3Lower.includes('child')) {
                        variantAttributes.ageGroup = 'Kids';
                      } else if (option3Lower.includes('teen')) {
                        variantAttributes.ageGroup = 'Adult'; // Google considers teens as adults
                      } else if (option3Lower.includes('adult')) {
                        variantAttributes.ageGroup = 'Adult';
                      }
                    }
                  }
                  
                  // Format variant ID if needed (ensure it has the Shopify GID format)
                  const variantId = variant.id.includes('gid://shopify/ProductVariant/') 
                    ? variant.id 
                    : `gid://shopify/ProductVariant/${variant.id}`;
                    
                  await this.storeService.updateGoogleAttributes(variantId, variantAttributes);
                } catch (variantError) {
                  console.error(`Error updating variant ${variant.id} for product ${productId}: ${variantError instanceof Error ? variantError.message : 'Unknown error'}`);
                  // We don't fail the whole product if just a variant fails
                }
              }
            }
          }
          
          updatedProducts.push(productId);
        } catch (error) {
          failedProducts.push(productId);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          this.incrementError(errorReasons, errorMessage);
        }
      }

      // Build a summary message
      let message = `Updated ${updatedProducts.length} products with Google attributes.`;
      if (failedProducts.length > 0) {
        message += ` Failed to update ${failedProducts.length} products.`;
        
        // Add error summary if there are failures
        const errorSummary = Array.from(errorReasons.entries())
          .map(([reason, count]) => `- ${reason}: ${count} products`)
          .join('\n');
          
        message += `\nError summary:\n${errorSummary}`;
      }

      return {
        success: failedProducts.length === 0,
        message,
        updatedProducts,
        failedProducts
      };
    } catch (error) {
      throw new Error(`Failed to auto-update Google attributes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Helper method to validate Google attributes
  private validateGoogleAttributes(attributes: GoogleProductAttributes): boolean {
    const { category, color, size, gender, ageGroup } = attributes;
    return !!(category && color && size && gender && ageGroup);
  }
  
  // Helper method to increment error counts
  private incrementError(errorMap: Map<string, number>, reason: string): void {
    errorMap.set(reason, (errorMap.get(reason) || 0) + 1);
  }
  
  // Helper method to detect Google attributes from product data
  private async detectGoogleAttributes(product: Product): Promise<GoogleProductAttributes> {
    const attributes: GoogleProductAttributes = {
      category: '',
      color: '',
      size: '',
      gender: '',
      ageGroup: ''
    };
    
    // Get the product title and any existing metadata
    const title = product.title || '';
    const tags = Array.isArray(product.tags) ? product.tags.join(' ') : (product.tags || '');
    const product_type = product.product_type || '';
    
    // Combine all text fields for analysis
    const combinedText = `${title} ${tags} ${product_type}`.toLowerCase();
    
    // Detect product category (simplified approach - would be more sophisticated in production)
    if (product_type) {
      // Use product_type as the primary source for category
      attributes.category = this.mapToGoogleCategory(product_type);
    } else if (combinedText.includes('shirt') || combinedText.includes('tshirt') || combinedText.includes('t-shirt')) {
      attributes.category = 'Apparel & Accessories > Clothing > Shirts & Tops';
    } else if (combinedText.includes('pants') || combinedText.includes('trouser')) {
      attributes.category = 'Apparel & Accessories > Clothing > Pants';
    } else if (combinedText.includes('shoe') || combinedText.includes('sneaker') || combinedText.includes('footwear')) {
      attributes.category = 'Apparel & Accessories > Shoes';
    } else if (combinedText.includes('jacket') || combinedText.includes('coat')) {
      attributes.category = 'Apparel & Accessories > Clothing > Outerwear';
    } else if (combinedText.includes('dress')) {
      attributes.category = 'Apparel & Accessories > Clothing > Dresses';
    } else {
      attributes.category = 'Apparel & Accessories > Clothing';
    }
    
    // Detect color
    const colors = ['red', 'blue', 'green', 'yellow', 'black', 'white', 'purple', 'orange', 'pink', 'brown', 'gray', 'grey'];
    for (const color of colors) {
      if (combinedText.includes(color)) {
        attributes.color = color.charAt(0).toUpperCase() + color.slice(1);
        break;
      }
    }
    
    // If color not found, default to most common attribute
    if (!attributes.color) {
      attributes.color = 'Black';
    }
    
    // Detect size
    type SizeMap = { [key: string]: string };
    
    const sizePatterns = [
      { regex: /\b(xs|s|m|l|xl|xxl|xxxl)\b/i, map: { 'xs': 'XS', 's': 'S', 'm': 'M', 'l': 'L', 'xl': 'XL', 'xxl': '2XL', 'xxxl': '3XL' } as SizeMap },
      { regex: /\b(small|medium|large)\b/i, map: { 'small': 'S', 'medium': 'M', 'large': 'L' } as SizeMap },
      { regex: /\b(one size|one-size|os)\b/i, value: 'One Size' },
      { regex: /\b(\d+)\b/, isNumeric: true }
    ];
    
    for (const pattern of sizePatterns) {
      const match = combinedText.match(pattern.regex);
      if (match) {
        if (pattern.isNumeric) {
          attributes.size = match[1];
        } else if (pattern.value) {
          attributes.size = pattern.value;
        } else if (pattern.map && match[1].toLowerCase() in pattern.map) {
          const key = match[1].toLowerCase();
          attributes.size = pattern.map[key];
        }
        break;
      }
    }
    
    // If size not found, use a default
    if (!attributes.size) {
      attributes.size = 'M';
    }
    
    // Detect gender
    if (combinedText.includes('women') || combinedText.includes('woman') || combinedText.includes('female')) {
      attributes.gender = 'Female';
    } else if (combinedText.includes('men') || combinedText.includes('man') || combinedText.includes('male')) {
      attributes.gender = 'Male';
    } else if (combinedText.includes('unisex')) {
      attributes.gender = 'Unisex';
    } else {
      // Default gender based on product type as a fallback
      if (combinedText.includes('dress') || combinedText.includes('skirt') || combinedText.includes('bra')) {
        attributes.gender = 'Female';
      } else {
        attributes.gender = 'Unisex';
      }
    }
    
    // Detect age group
    if (combinedText.includes('kid') || combinedText.includes('child') || combinedText.includes('youth') || combinedText.includes('junior')) {
      if (combinedText.includes('newborn') || combinedText.includes('infant') || combinedText.includes('baby')) {
        attributes.ageGroup = 'Newborn';
      } else {
        attributes.ageGroup = 'Kids';
      }
    } else if (combinedText.includes('teen') || combinedText.includes('adolescent')) {
      attributes.ageGroup = 'Adult';
    } else {
      attributes.ageGroup = 'Adult';
    }
    
    return attributes;
  }
  
  // Map product type to Google product category
  private mapToGoogleCategory(productType: string): string {
    const typeMap: Record<string, string> = {
      'shirt': 'Apparel & Accessories > Clothing > Shirts & Tops',
      't-shirt': 'Apparel & Accessories > Clothing > Shirts & Tops',
      'tshirt': 'Apparel & Accessories > Clothing > Shirts & Tops',
      'pants': 'Apparel & Accessories > Clothing > Pants',
      'jeans': 'Apparel & Accessories > Clothing > Pants > Jeans',
      'shorts': 'Apparel & Accessories > Clothing > Shorts',
      'dress': 'Apparel & Accessories > Clothing > Dresses',
      'skirt': 'Apparel & Accessories > Clothing > Skirts',
      'jacket': 'Apparel & Accessories > Clothing > Outerwear > Jackets',
      'coat': 'Apparel & Accessories > Clothing > Outerwear > Coats',
      'sweater': 'Apparel & Accessories > Clothing > Sweaters',
      'hoodie': 'Apparel & Accessories > Clothing > Hoodies & Sweatshirts',
      'sweatshirt': 'Apparel & Accessories > Clothing > Hoodies & Sweatshirts',
      'shoes': 'Apparel & Accessories > Shoes',
      'sneakers': 'Apparel & Accessories > Shoes > Athletic Shoes',
      'boots': 'Apparel & Accessories > Shoes > Boots',
      'sandals': 'Apparel & Accessories > Shoes > Sandals',
      'hat': 'Apparel & Accessories > Clothing Accessories > Hats',
      'cap': 'Apparel & Accessories > Clothing Accessories > Hats',
      'scarf': 'Apparel & Accessories > Clothing Accessories > Scarves & Shawls',
      'socks': 'Apparel & Accessories > Clothing Accessories > Socks',
      'belt': 'Apparel & Accessories > Clothing Accessories > Belts',
      'bag': 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
      'purse': 'Apparel & Accessories > Handbags, Wallets & Cases > Handbags',
      'backpack': 'Apparel & Accessories > Handbags, Wallets & Cases > Backpacks',
      'wallet': 'Apparel & Accessories > Handbags, Wallets & Cases > Wallets & Money Clips',
      'jewelry': 'Apparel & Accessories > Jewelry',
      'necklace': 'Apparel & Accessories > Jewelry > Necklaces',
      'bracelet': 'Apparel & Accessories > Jewelry > Bracelets',
      'earrings': 'Apparel & Accessories > Jewelry > Earrings',
      'ring': 'Apparel & Accessories > Jewelry > Rings',
      'watch': 'Apparel & Accessories > Jewelry > Watches'
    };
    
    const lowerType = productType.toLowerCase();
    
    // Check for direct matches first
    if (typeMap[lowerType]) {
      return typeMap[lowerType];
    }
    
    // Check if the product type contains any of our known types
    for (const [key, category] of Object.entries(typeMap)) {
      if (lowerType.includes(key)) {
        return category;
      }
    }
    
    // Default fallback
    return 'Apparel & Accessories > Clothing';
  }

  // Helper method to normalize size
  private normalizeSize(sizeStr: string): string {
    const sizeStr_lower = sizeStr.toLowerCase();
    
    // Standard sizing conversions
    if (sizeStr_lower === 'xs' || sizeStr_lower === 'xsmall' || sizeStr_lower === 'extra small') return 'XS';
    if (sizeStr_lower === 's' || sizeStr_lower === 'small') return 'S';
    if (sizeStr_lower === 'm' || sizeStr_lower === 'medium') return 'M';
    if (sizeStr_lower === 'l' || sizeStr_lower === 'large') return 'L';
    if (sizeStr_lower === 'xl' || sizeStr_lower === 'xlarge' || sizeStr_lower === 'extra large') return 'XL';
    if (sizeStr_lower === 'xxl' || sizeStr_lower === '2xl') return '2XL';
    if (sizeStr_lower === 'xxxl' || sizeStr_lower === '3xl') return '3XL';
    if (sizeStr_lower === 'one size' || sizeStr_lower === 'onesize' || sizeStr_lower === 'os') return 'One Size';
    
    // If it's numeric, return as is
    if (/^\d+$/.test(sizeStr)) return sizeStr;
    
    // If we can't normalize it, return the original string with first letter capitalized
    return this.capitalizeFirstLetter(sizeStr);
  }
  
  // Helper method to check if a string looks like a color
  private isColor(str: string): boolean {
    const commonColors = [
      'red', 'blue', 'green', 'yellow', 'black', 'white', 'purple', 
      'orange', 'pink', 'brown', 'gray', 'grey', 'silver', 'gold', 
      'beige', 'navy', 'teal', 'olive', 'maroon', 'coral', 'turquoise', 
      'magenta', 'cyan', 'indigo', 'violet', 'khaki', 'tan', 'aqua',
      'lavender', 'lime', 'mint', 'peach', 'salmon', 'crimson'
    ];
    
    return commonColors.some(color => str.includes(color));
  }
  
  // Helper method to capitalize first letter
  private capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  async previewGoogleAttributes(productIds: string[]): Promise<{
    success: boolean;
    message: string;
    products: Array<{
      id: string;
      title?: string;
      detectedAttributes: GoogleProductAttributes;
      variants?: Array<{
        id: string;
        title?: string;
        detectedAttributes: GoogleProductAttributes;
      }>;
    }>;
  }> {
    try {
      const productsWithAttributes: Array<{
        id: string;
        title?: string;
        detectedAttributes: GoogleProductAttributes;
        variants?: Array<{
          id: string;
          title?: string;
          detectedAttributes: GoogleProductAttributes;
        }>;
      }> = [];
      
      // Process each product
      for (const productId of productIds) {
        try {
          // Get product details to analyze
          const product = await this.storeService.getProduct(productId);
          
          if (!product) {
            productsWithAttributes.push({
              id: productId,
              title: undefined,
              detectedAttributes: {
                category: '',
                color: '',
                size: '',
                gender: '',
                ageGroup: ''
              }
            });
            continue;
          }
          
          // Auto-detect attributes based on product details
          const attributes = await this.detectGoogleAttributes(product);
          
          // Check if there are more than 2 variants
          const hasMultipleVariants = product.variants && 
                                     Array.isArray(product.variants) && 
                                     product.variants.length > 2;
          
          // If we have multiple variants, only keep the category attribute for the product
          let productAttributes: GoogleProductAttributes;
          if (hasMultipleVariants) {
            productAttributes = {
              category: attributes.category,
              color: '',
              size: '',
              gender: '',
              ageGroup: ''
            };
          } else {
            productAttributes = attributes;
          }
          
          // Process variants if any
          const variants: Array<{
            id: string;
            title?: string;
            detectedAttributes: GoogleProductAttributes;
          }> = [];
          
          if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
            for (const variant of product.variants) {
              if (variant.id) {
                // For variants in a multi-variant product, customize attributes
                if (hasMultipleVariants) {
                  // Start with the main detected attributes
                  const variantAttributes: GoogleProductAttributes = {
                    category: '',
                    color: attributes.color,
                    size: attributes.size,
                    gender: attributes.gender,
                    ageGroup: attributes.ageGroup
                  };
                  
                  // Customize based on variant options if possible
                  if (variant.option1 && typeof variant.option1 === 'string') {
                    const option1Lower = variant.option1.toLowerCase();
                    
                    // Check if option1 looks like a size
                    if (/^(xs|s|m|l|xl|xxl|xxxl|[0-9]+)$/i.test(option1Lower) || 
                        /^(small|medium|large|one size)$/i.test(option1Lower)) {
                      variantAttributes.size = this.normalizeSize(variant.option1);
                    } 
                    // Check if option1 looks like a color
                    else if (this.isColor(option1Lower)) {
                      variantAttributes.color = this.capitalizeFirstLetter(option1Lower);
                    }
                  }
                  
                  if (variant.option2 && typeof variant.option2 === 'string') {
                    const option2Lower = variant.option2.toLowerCase();
                    
                    // Check if option2 looks like a size
                    if (/^(xs|s|m|l|xl|xxl|xxxl|[0-9]+)$/i.test(option2Lower) || 
                        /^(small|medium|large|one size)$/i.test(option2Lower)) {
                      variantAttributes.size = this.normalizeSize(variant.option2);
                    } 
                    // Check if option2 looks like a color
                    else if (this.isColor(option2Lower)) {
                      variantAttributes.color = this.capitalizeFirstLetter(option2Lower);
                    }
                  }
                  
                  variants.push({
                    id: variant.id,
                    title: variant.title,
                    detectedAttributes: variantAttributes
                  });
                } else {
                  // For products with 2 or fewer variants, just inherit the product attributes
                  variants.push({
                    id: variant.id,
                    title: variant.title,
                    detectedAttributes: { ...attributes }
                  });
                }
              }
            }
          }
          
          productsWithAttributes.push({
            id: productId,
            title: product.title,
            detectedAttributes: productAttributes,
            variants: variants.length > 0 ? variants : undefined
          });
        } catch (error) {
          productsWithAttributes.push({
            id: productId,
            title: undefined,
            detectedAttributes: {
              category: '',
              color: '',
              size: '',
              gender: '',
              ageGroup: ''
            }
          });
        }
      }

      return {
        success: true,
        message: `Preview of detected Google attributes for ${productIds.length} products and their variants`,
        products: productsWithAttributes
      };
    } catch (error) {
      throw new Error(`Failed to preview Google attributes: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
} 