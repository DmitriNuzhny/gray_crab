import { Request, Response } from 'express';
import { ProductService } from '../services/productService';
import { StoreService } from '../services/storeService';

export class ProductController {
  private storeService: StoreService;
  private productService: ProductService;

  constructor() {
    this.storeService = new StoreService();
    this.productService = new ProductService(this.storeService);
  }

  getAllSalesChannels = async (req: Request, res: Response) => {
    try {
      const salesChannels = await this.storeService.getAllSalesChannels();
      res.json({
        success: true,
        message: 'Sales channels fetched successfully',
        data: salesChannels
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching sales channels',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  bulkUpdateSalesChannels = async (req: Request, res: Response) => {
    try {
      const { salesChannels } = req.body;

      if (!Array.isArray(salesChannels)) {
        return res.status(400).json({ 
          success: false, 
          message: 'salesChannels must be an array' 
        });
      }

      const result = await this.storeService.bulkUpdateSalesChannels(salesChannels);
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to bulk update sales channels',
        updatedProducts: [],
        failedProducts: []
      });
    }
  };

  bulkUpdateSalesChannelsByIds = async (req: Request, res: Response) => {
    try {
      const { productIds, salesChannels } = req.body;

      if (!Array.isArray(productIds) || !Array.isArray(salesChannels)) {
        return res.status(400).json({ 
          success: false, 
          message: 'productIds and salesChannels must be arrays' 
        });
      }

      // Set a longer timeout for large operations (15 minutes)
      req.setTimeout(900000);
      
      // Send initial response to client
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });
      
      // Start the update process
      res.write(JSON.stringify({
        status: 'processing',
        message: `Starting update for ${productIds.length} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed: 0,
      }) + '\n');
      
      // Split into smaller batches for very large requests
      // Process in chunks to update client with progress
      const BATCH_SIZE = 250; // Reduced batch size for more frequent updates
      let processed = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;
      const failureDetails = new Map();
      
      for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
        const batch = productIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);
        
        try {
          // Send batch start notification
          res.write(JSON.stringify({
            status: 'batch_started',
            message: `Processing batch ${batchNumber} of ${totalBatches}`,
            timestamp: new Date().toISOString(),
            batchSize: batch.length,
            batchNumber,
            totalBatches
          }) + '\n');
          
          const result = await this.productService.bulkUpdateSalesChannels({
            productIds: batch,
            salesChannels
          });
          
          processed += batch.length;
          totalSuccesses += result.updatedProducts?.length || 0;
          totalFailures += result.failedProducts?.length || 0;
          
          // Collect failure details
          if (result.failedProducts && result.failedProducts.length > 0) {
            // Extract error details from the message if available
            const errorMatch = result.message.match(/Error summary:\n(.*)/s);
            if (errorMatch && errorMatch[1]) {
              const errorLines = errorMatch[1].split('\n');
              errorLines.forEach(line => {
                const matches = line.match(/- (.*): (\d+) products/);
                if (matches) {
                  const [_, errorType, count] = matches;
                  failureDetails.set(
                    errorType, 
                    (failureDetails.get(errorType) || 0) + parseInt(count, 10)
                  );
                }
              });
            }
          }
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'batch_completed',
            message: `Processed ${processed} of ${productIds.length} products`,
            timestamp: new Date().toISOString(),
            total: productIds.length,
            processed,
            successes: totalSuccesses,
            failures: totalFailures,
            batchResults: {
              success: result.success,
              updatedCount: result.updatedProducts?.length || 0,
              failedCount: result.failedProducts?.length || 0,
              batchNumber,
              totalBatches
            }
          }) + '\n');
        } catch (error) {
          // Send error for this batch but continue processing
          totalFailures += batch.length;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Track the error
          failureDetails.set(
            errorMessage, 
            (failureDetails.get(errorMessage) || 0) + batch.length
          );
          
          res.write(JSON.stringify({
            status: 'batch_error',
            message: `Error processing batch ${batchNumber} of ${totalBatches}`,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Continue with next batch despite the error
          processed += batch.length;
        }
        
        // Add a small delay between batches to prevent client overload
        if (i + BATCH_SIZE < productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Format error details for the final response
      const errorSummary = Array.from(failureDetails.entries())
        .map(([error, count]) => `- ${error}: ${count} products`)
        .join('\n');
      
      // Send final completion message
      res.write(JSON.stringify({
        status: 'completed',
        message: `Completed processing ${processed} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed,
        successes: totalSuccesses,
        failures: totalFailures,
        errorSummary: totalFailures > 0 ? errorSummary : null
      }) + '\n');
      
      res.end();
    } catch (error) {
      // If we haven't started streaming yet, send a regular error response
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to bulk update sales channels',
          updatedProducts: [],
          failedProducts: []
        });
      } else {
        // Otherwise end the stream with an error
        res.write(JSON.stringify({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to bulk update sales channels',
          timestamp: new Date().toISOString()
        }) + '\n');
        res.end();
      }
    }
  };

  getProduct = async (req: Request, res: Response) => {
    try {
      const productId = req.params.id;
      const product = await this.productService.getProduct(productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      res.json({
        success: true,
        message: 'Product fetched successfully',
        data: product
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  getAllProducts = async (req: Request, res: Response) => {
    try {
      const products = await this.productService.getAllProducts();
      res.json({
        success: true,
        message: 'Products fetched successfully',
        data: products
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching products',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  createProduct = async (req: Request, res: Response) => {
    try {
      const product = await this.productService.createProduct(req.body);
      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: product
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error creating product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  updateProductSalesChannels = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { salesChannels } = req.body;

      if (!Array.isArray(salesChannels)) {
        return res.status(400).json({ 
          success: false, 
          message: 'salesChannels must be an array' 
        });
      }

      const updatedProduct = await this.storeService.updateProductSalesChannels(id, salesChannels);
      res.json({ 
        success: true, 
        message: 'Product sales channels updated successfully',
        data: updatedProduct 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to update product sales channels' 
      });
    }
  };

  getProductsMissingChannels = async (req: Request, res: Response) => {
    try {
      const productIds = await this.productService.getProductsMissingChannels();
      res.json({
        success: true,
        message: 'Products missing sales channels fetched successfully',
        count: productIds.length,
        data: productIds
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching products missing sales channels',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  getProductsWithGoogleYouTubeErrors = async (req: Request, res: Response) => {
    try {
      const productIds = await this.storeService.getProductsWithGoogleYouTubeErrors();
      res.json({
        success: true,
        message: 'Products with Google & YouTube channel but missing required attributes fetched successfully',
        count: productIds.length,
        data: productIds
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching products with Google & YouTube channel missing required attributes',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  bulkUpdateGoogleAttributes = async (req: Request, res: Response) => {
    try {
      const { productIds, attributes } = req.body;

      if (!Array.isArray(productIds)) {
        return res.status(400).json({ 
          success: false, 
          message: 'productIds must be an array' 
        });
      }

      if (!attributes || typeof attributes !== 'object') {
        return res.status(400).json({
          success: false,
          message: 'attributes must be an object with Google product attributes'
        });
      }

      // Set a longer timeout for large operations (15 minutes)
      req.setTimeout(900000);
      
      // Send initial response to client
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });
      
      // Start the update process
      res.write(JSON.stringify({
        status: 'processing',
        message: `Starting Google attributes update for ${productIds.length} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed: 0,
      }) + '\n');
      
      // Split into smaller batches for very large requests
      // Process in chunks to update client with progress
      const BATCH_SIZE = 250; // Reduced batch size for more frequent updates
      let processed = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;
      const failureDetails = new Map();
      
      for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
        const batch = productIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);
        
        try {
          // Send batch start notification
          res.write(JSON.stringify({
            status: 'batch_started',
            message: `Processing batch ${batchNumber} of ${totalBatches}`,
            timestamp: new Date().toISOString(),
            batchSize: batch.length,
            batchNumber,
            totalBatches
          }) + '\n');
          
          const result = await this.productService.bulkUpdateGoogleAttributes({
            productIds: batch,
            attributes
          });
          
          processed += batch.length;
          totalSuccesses += result.updatedProducts?.length || 0;
          totalFailures += result.failedProducts?.length || 0;
          
          // Collect failure details
          if (result.failedProducts && result.failedProducts.length > 0) {
            // Extract error details from the message if available
            const errorMatch = result.message.match(/Error summary:\n(.*)/s);
            if (errorMatch && errorMatch[1]) {
              const errorLines = errorMatch[1].split('\n');
              errorLines.forEach(line => {
                const matches = line.match(/- (.*): (\d+) products/);
                if (matches) {
                  const [_, errorType, count] = matches;
                  failureDetails.set(
                    errorType, 
                    (failureDetails.get(errorType) || 0) + parseInt(count, 10)
                  );
                }
              });
            }
          }
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'batch_completed',
            message: `Processed ${processed} of ${productIds.length} products`,
            timestamp: new Date().toISOString(),
            total: productIds.length,
            processed,
            successes: totalSuccesses,
            failures: totalFailures,
            batchResults: {
              success: result.success,
              updatedCount: result.updatedProducts?.length || 0,
              failedCount: result.failedProducts?.length || 0,
              batchNumber,
              totalBatches
            }
          }) + '\n');
        } catch (error) {
          // Send error for this batch but continue processing
          totalFailures += batch.length;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Track the error
          failureDetails.set(
            errorMessage, 
            (failureDetails.get(errorMessage) || 0) + batch.length
          );
          
          res.write(JSON.stringify({
            status: 'batch_error',
            message: `Error processing batch ${batchNumber} of ${totalBatches}`,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Continue with next batch despite the error
          processed += batch.length;
        }
        
        // Add a small delay between batches to prevent client overload
        if (i + BATCH_SIZE < productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      // Format error details for the final response
      const errorSummary = Array.from(failureDetails.entries())
        .map(([error, count]) => `- ${error}: ${count} products`)
        .join('\n');
      
      // Send final completion message
      res.write(JSON.stringify({
        status: 'completed',
        message: `Completed updating Google attributes for ${processed} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed,
        successes: totalSuccesses,
        failures: totalFailures,
        errorSummary: totalFailures > 0 ? errorSummary : null
      }) + '\n');
      
      res.end();
    } catch (error) {
      // If we haven't started streaming yet, send a regular error response
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to update Google attributes',
          updatedProducts: [],
          failedProducts: []
        });
      } else {
        // Otherwise end the stream with an error
        res.write(JSON.stringify({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to update Google attributes',
          timestamp: new Date().toISOString()
        }) + '\n');
        res.end();
      }
    }
  };

  autoUpdateGoogleAttributes = async (req: Request, res: Response) => {
    try {
      const { productIds } = req.body;
      
      if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
        res.status(400).json({ 
          success: false, 
          message: 'Request must include a non-empty array of productIds' 
        });
        return;
      }
      
      // Set a longer timeout for this operation (30 minutes)
      req.setTimeout(1800000);
      
      // Send initial response to client with chunked transfer encoding
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });
      
      // Start the auto-update process
      res.write(JSON.stringify({
        status: 'processing',
        message: `Starting automatic Google attributes update for ${productIds.length} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length
      }) + '\n');
      
      // Process products in batches
      const BATCH_SIZE = 50;
      let processed = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;
      const failureDetails = new Map();
      
      // Keep track of assigned attributes for the final response
      const productsWithAttributes: Array<{
        id: string;
        title?: string;
        attributes: {
          category: string;
          color: string;
          size: string;
          gender: string;
          ageGroup: string;
        };
        variants?: Array<{
          id: string;
          title?: string;
          attributes: {
            color: string;
            size: string;
            gender: string;
            ageGroup: string;
          };
        }>;
      }> = [];
      
      for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
        const batch = productIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);
        
        try {
          res.write(JSON.stringify({
            status: 'batch_started',
            message: `Processing batch ${batchNumber} of ${totalBatches}`,
            timestamp: new Date().toISOString(),
            batchSize: batch.length,
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Get preview of attributes first to capture what will be assigned
          const preview = await this.productService.previewGoogleAttributes(batch);
          
          // Process each product in the batch to detect and set attributes
          const result = await this.productService.autoUpdateGoogleAttributes(batch);
          
          // Add successfully processed products to our attribute tracking
          preview.products.forEach(product => {
            if (result.updatedProducts.includes(product.id)) {
              productsWithAttributes.push({
                id: product.id,
                title: product.title,
                attributes: {
                  category: product.detectedAttributes.category || '',
                  color: product.detectedAttributes.color || '',
                  size: product.detectedAttributes.size || '',
                  gender: product.detectedAttributes.gender || '',
                  ageGroup: product.detectedAttributes.ageGroup || ''
                },
                variants: product.variants?.map(variant => ({
                  id: variant.id,
                  title: variant.title,
                  attributes: {
                    color: variant.detectedAttributes.color || '',
                    size: variant.detectedAttributes.size || '',
                    gender: variant.detectedAttributes.gender || '',
                    ageGroup: variant.detectedAttributes.ageGroup || ''
                  }
                }))
              });
            }
          });
          
          processed += batch.length;
          totalSuccesses += result.updatedProducts?.length || 0;
          totalFailures += result.failedProducts?.length || 0;
          
          // Collect failure details
          if (result.failedProducts && result.failedProducts.length > 0) {
            // Extract error details if available
            const errorMatch = result.message.match(/Error summary:\n(.*)/s);
            if (errorMatch && errorMatch[1]) {
              const errorLines = errorMatch[1].split('\n');
              errorLines.forEach((line: string) => {
                const matches = line.match(/- (.*): (\d+) products/);
                if (matches) {
                  const [_, errorType, count] = matches;
                  failureDetails.set(
                    errorType, 
                    (failureDetails.get(errorType) || 0) + parseInt(count, 10)
                  );
                }
              });
            }
          }
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'batch_completed',
            message: `Processed ${processed} of ${productIds.length} products`,
            timestamp: new Date().toISOString(),
            total: productIds.length,
            processed,
            successes: totalSuccesses,
            failures: totalFailures,
            batchResults: {
              success: result.success,
              updatedCount: result.updatedProducts?.length || 0,
              failedCount: result.failedProducts?.length || 0,
              batchNumber,
              totalBatches
            }
          }) + '\n');
        } catch (error) {
          // Handle errors for this batch
          totalFailures += batch.length;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Track the error
          failureDetails.set(
            errorMessage, 
            (failureDetails.get(errorMessage) || 0) + batch.length
          );
          
          res.write(JSON.stringify({
            status: 'batch_error',
            message: `Error processing batch ${batchNumber} of ${totalBatches}`,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Continue with next batch despite the error
          processed += batch.length;
        }
        
        // Add a small delay between batches
        if (i + BATCH_SIZE < productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Format error details for the final response
      const errorSummary = Array.from(failureDetails.entries())
        .map(([error, count]) => `- ${error}: ${count} products`)
        .join('\n');
      
      // Send final completion message
      res.write(JSON.stringify({
        status: 'completed',
        message: `Completed auto-updating Google attributes for ${processed} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed,
        successes: totalSuccesses,
        failures: totalFailures,
        errorSummary: totalFailures > 0 ? errorSummary : null,
        products: productsWithAttributes
      }) + '\n');
      
      res.end();
    } catch (error) {
      // If we haven't started streaming yet, send a regular error response
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to auto-update Google attributes',
        });
      } else {
        // Otherwise end the stream with an error
        res.write(JSON.stringify({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to auto-update Google attributes',
          timestamp: new Date().toISOString()
        }) + '\n');
        res.end();
      }
    }
  };

  applyGoogleAttributes = async (req: Request, res: Response) => {
    try {
      const { productIds } = req.body;

      if (!Array.isArray(productIds) || productIds.length === 0) {
        return res.status(400).json({ 
          success: false, 
          message: 'productIds must be a non-empty array' 
        });
      }
      
      // Set a longer timeout for this operation (30 minutes)
      req.setTimeout(1800000);
      
      // Send initial response to client with chunked transfer encoding
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      });
      
      // Start the auto-update process
      res.write(JSON.stringify({
        status: 'processing',
        message: `Starting automatic Google attributes update for ${productIds.length} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length
      }) + '\n');
      
      // Process products in batches
      const BATCH_SIZE = 50;
      let processed = 0;
      let totalSuccesses = 0;
      let totalFailures = 0;
      const failureDetails = new Map();
      
      for (let i = 0; i < productIds.length; i += BATCH_SIZE) {
        const batch = productIds.slice(i, i + BATCH_SIZE);
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);
        
        try {
          res.write(JSON.stringify({
            status: 'batch_started',
            message: `Processing batch ${batchNumber} of ${totalBatches}`,
            timestamp: new Date().toISOString(),
            batchSize: batch.length,
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Process each product in the batch to detect and set attributes
          const result = await this.productService.autoUpdateGoogleAttributes(batch);
          
          processed += batch.length;
          totalSuccesses += result.updatedProducts?.length || 0;
          totalFailures += result.failedProducts?.length || 0;
          
          // Collect failure details
          if (result.failedProducts && result.failedProducts.length > 0) {
            // Extract error details if available
            const errorMatch = result.message.match(/Error summary:\n(.*)/s);
            if (errorMatch && errorMatch[1]) {
              const errorLines = errorMatch[1].split('\n');
              errorLines.forEach((line: string) => {
                const matches = line.match(/- (.*): (\d+) products/);
                if (matches) {
                  const [_, errorType, count] = matches;
                  failureDetails.set(
                    errorType, 
                    (failureDetails.get(errorType) || 0) + parseInt(count, 10)
                  );
                }
              });
            }
          }
          
          // Send progress update
          res.write(JSON.stringify({
            status: 'batch_completed',
            message: `Processed ${processed} of ${productIds.length} products`,
            timestamp: new Date().toISOString(),
            total: productIds.length,
            processed,
            successes: totalSuccesses,
            failures: totalFailures,
            batchResults: {
              success: result.success,
              updatedCount: result.updatedProducts?.length || 0,
              failedCount: result.failedProducts?.length || 0,
              batchNumber,
              totalBatches
            }
          }) + '\n');
        } catch (error) {
          // Handle errors for this batch
          totalFailures += batch.length;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          
          // Track the error
          failureDetails.set(
            errorMessage, 
            (failureDetails.get(errorMessage) || 0) + batch.length
          );
          
          res.write(JSON.stringify({
            status: 'batch_error',
            message: `Error processing batch ${batchNumber} of ${totalBatches}`,
            error: errorMessage,
            timestamp: new Date().toISOString(),
            batchNumber,
            totalBatches
          }) + '\n');
          
          // Continue with next batch despite the error
          processed += batch.length;
        }
        
        // Add a small delay between batches
        if (i + BATCH_SIZE < productIds.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Format error details for the final response
      const errorSummary = Array.from(failureDetails.entries())
        .map(([error, count]) => `- ${error}: ${count} products`)
        .join('\n');
      
      // Send final completion message
      res.write(JSON.stringify({
        status: 'completed',
        message: `Completed auto-updating Google attributes for ${processed} products`,
        timestamp: new Date().toISOString(),
        total: productIds.length,
        processed,
        successes: totalSuccesses,
        failures: totalFailures,
        errorSummary: totalFailures > 0 ? errorSummary : null
      }) + '\n');
      
      res.end();
    } catch (error) {
      // If we haven't started streaming yet, send a regular error response
      if (!res.headersSent) {
        res.status(500).json({ 
          success: false, 
          message: error instanceof Error ? error.message : 'Failed to auto-update Google attributes',
        });
      } else {
        // Otherwise end the stream with an error
        res.write(JSON.stringify({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to auto-update Google attributes',
          timestamp: new Date().toISOString()
        }) + '\n');
        res.end();
      }
    }
  };
} 