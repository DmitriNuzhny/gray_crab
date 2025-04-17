import axios from 'axios';
import { Product, GoogleProductAttributes } from '../types/product';
import { env } from '../config/env';

export class StoreService {
  private baseUrl: string;
  private apiKey: string;
  private graphqlUrl: string;

  // Cache for publication IDs to avoid repeated API calls
  private publicationMapCache: Map<string, string> | null = null;

  // Add a token bucket rate limiter
  private tokenBucket = {
    tokens: 30,  // Start with fewer tokens to be conservative
    lastRefill: Date.now(),
    maxTokens: 30, // Lower max tokens
    refillRate: 1, // Reduce to 1 token per second (Shopify limit is 2/second)
  };

  constructor() {
    this.baseUrl = env.storeApiUrl;
    this.apiKey = env.storeApiKey;
    
    // Extract shop domain from the REST API URL
    // From: https://your-store.myshopify.com/admin/api/2024-04/products.json
    // To: https://your-store.myshopify.com/admin/api/2024-04/graphql.json
    const shopUrl = this.baseUrl.split('/admin')[0];
    
    // Extract API version from the REST API URL or default to 2024-04
    const apiVersionMatch = this.baseUrl.match(/\/admin\/api\/([^\/]+)\//);
    const apiVersion = apiVersionMatch ? apiVersionMatch[1] : '2024-04';
    
    this.graphqlUrl = `${shopUrl}/admin/api/${apiVersion}/graphql.json`;
    
    if (!this.baseUrl) {
      throw new Error('SHOPIFY_STORE_ADMIN_API_URL environment variable is not set');
    }
    if (!this.apiKey) {
      throw new Error('SHOPIFY_STORE_ACCESS_TOKEN environment variable is not set');
    }
  }

  private getHeaders() {
    return {
      'X-Shopify-Access-Token': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  // Method to consume a token, returns true if token was consumed, false if need to wait
  private async consumeToken(cost = 1): Promise<boolean> {
    // Refill tokens based on time elapsed
    const now = Date.now();
    const elapsedSeconds = (now - this.tokenBucket.lastRefill) / 1000;
    this.tokenBucket.tokens = Math.min(
      this.tokenBucket.maxTokens,
      this.tokenBucket.tokens + elapsedSeconds * this.tokenBucket.refillRate
    );
    this.tokenBucket.lastRefill = now;
    
    // Check if we have enough tokens
    if (this.tokenBucket.tokens >= cost) {
      this.tokenBucket.tokens -= cost;
      // Add a small delay even when we have tokens to avoid bursts
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } else {
      // Calculate wait time needed to have enough tokens
      const waitTimeMs = ((cost - this.tokenBucket.tokens) / this.tokenBucket.refillRate) * 1000;
      console.log(`Rate limiting ourselves, waiting ${waitTimeMs.toFixed(0)}ms before processing next request`);
      await new Promise(resolve => setTimeout(resolve, waitTimeMs + 200)); // Add buffer
      this.tokenBucket.tokens = 0; // Used all available tokens plus waited
      this.tokenBucket.lastRefill = Date.now();
      return true;
    }
  }

  private async makeRequest(url: string, data: any, retries = 3, timeout = 30000) {
    let lastError;
    let retryCount = 0;
    
    while (retryCount <= retries) {
      try {
        // Self-imposed rate limiting - consume a token before making request
        await this.consumeToken(1);
        
        const response = await axios.post(url, data, { 
          headers: this.getHeaders(),
          timeout // Set timeout to prevent hanging requests
        });
        
        // Check for rate limit headers
        const callsLeft = response.headers['x-shopify-shop-api-call-limit'];
        if (callsLeft) {
          const [used, limit] = callsLeft.split('/').map(Number);
          const remainingPercent = 100 * (1 - used / limit);
          
          // If we're close to the limit, dynamically adjust our token bucket
          if (remainingPercent < 5) {
            console.warn(`⚠️ API rate limit critically low: ${callsLeft}. Throttling aggressively.`);
            // More aggressive throttling - wait longer with less tokens available
            this.tokenBucket.tokens = 0;
            this.tokenBucket.refillRate = 0.5; // Slow down to 1 request per 2 seconds
            await new Promise(resolve => setTimeout(resolve, 2000));
          } else if (remainingPercent < 20) {
            console.warn(`API rate limit getting low: ${callsLeft}. Throttling requests.`);
            // Reduce refill rate temporarily
            this.tokenBucket.refillRate = 1; // 1 request per second
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // Reset refill rate to normal when we have plenty of capacity
            this.tokenBucket.refillRate = 2;
          }
        }
        
        return response;
      } catch (error) {
        lastError = error;
        retryCount++;
        
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Request failed (attempt ${retryCount}/${retries + 1}): ${errorMessage}`);
        
        // Check for GraphQL throttling errors
        const isThrottled = 
          (axios.isAxiosError(error) && error.response?.status === 429) ||
          (axios.isAxiosError(error) && 
           error.response?.data?.errors?.some((e: any) => e.message === "Throttled" || 
                                              e.extensions?.code === "THROTTLED"));
        
        // Throttled response either from HTTP code or GraphQL error
        if (isThrottled) {
          // For throttling, use a more aggressive backoff strategy
          const waitTime = Math.pow(2, retryCount + 2) * 1000; // 4s, 8s, 16s, 32s...
          console.warn(`🛑 Rate limited by Shopify API. Waiting ${waitTime/1000}s before retrying. Retry ${retryCount}/${retries + 1}`);
          
          // Reset our token bucket to be very conservative
          this.tokenBucket.tokens = 0;
          this.tokenBucket.refillRate = 0.2; // Very slow rate - only 1 request per 5 seconds
          
          await new Promise(resolve => setTimeout(resolve, waitTime));
          
          // Don't count this as a retry and try again
          retryCount--;
          continue;
        }
        
        // Only retry on network errors or 5xx responses, not on 4xx errors (except 429)
        if (
          axios.isAxiosError(error) && 
          (error.code === 'ECONNABORTED' || 
           error.code === 'ETIMEDOUT' || 
           (error.response && error.response.status >= 500))
        ) {
          // Wait with exponential backoff before retrying (500ms, 1000ms, 2000ms, etc.)
          const delay = Math.pow(2, retryCount) * 500;
          console.log(`Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        // Don't retry on client errors (4xx) other than rate limiting
        throw error;
      }
    }
    
    throw lastError;
  }

  async getAllSalesChannels(): Promise<string[]> {
    try {
      const query = `
        {
          publications(first: 10) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `;

      const response = await axios.post(
        this.graphqlUrl,
        { query },
        { headers: this.getHeaders() }
      );

      if (response.data.errors) {
        throw new Error(response.data.errors[0].message);
      }

      const channels = response.data.data.publications.edges.map(
        (edge: any) => edge.node.name
      );

      return channels;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch sales channels: ${error.message}`);
      }
      throw new Error('Failed to fetch sales channels');
    }
  }

  private async getAllProductsWithPagination(cursor?: string): Promise<{ ids: string[], hasNextPage: boolean, lastCursor: string }> {
    const query = `
      query {
        products(first: 250${cursor ? `, after: "${cursor}"` : ''}) {
          edges {
            node {
              id
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    const response = await axios.post(
      this.graphqlUrl,
      { query },
      { headers: this.getHeaders() }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const edges = response.data.data.products.edges;
    const hasNextPage = response.data.data.products.pageInfo.hasNextPage;
    const lastCursor = edges[edges.length - 1]?.cursor;

    const productIds = edges.map((edge: any) => {
      const globalId = edge.node.id;
      return globalId.split('/').pop();
    });

    return {
      ids: productIds,
      hasNextPage,
      lastCursor
    };
  }

  async getAllProducts(): Promise<string[]> {
    try {
      const allProductIds: string[] = [];
      let hasNextPage = true;
      let cursor: string | undefined;

      while (hasNextPage) {
        const result = await this.getAllProductsWithPagination(cursor);
        allProductIds.push(...result.ids);
        hasNextPage = result.hasNextPage;
        cursor = result.lastCursor;
      }

      return allProductIds;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }
      throw new Error('Failed to fetch products from store');
    }
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      // Extract the shop domain and API version from the base URL
      // Format: https://your-store.myshopify.com/admin/api/2024-04/products.json
      const urlParts = this.baseUrl.match(/(https:\/\/.*\.myshopify\.com\/admin\/api\/[^\/]+)\//);
      if (!urlParts || urlParts.length < 2) {
        throw new Error('Invalid shop URL format');
      }
      
      const baseApiUrl = urlParts[1];
      const url = `${baseApiUrl}/products/${productId}.json`;
      
      console.log(`Fetching product from: ${url}`);
      
      const response = await axios.get(url, {
        headers: this.getHeaders()
      });
      return response.data.product;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error(`Error fetching product ${productId}:`, error.response?.status, error.response?.data);
        if (error.response?.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch product: ${error.message}`);
      }
      throw new Error('Failed to fetch product from store');
    }
  }

  private async getPublicationIds(): Promise<Map<string, string>> {
    // Use cached version if available
    if (this.publicationMapCache) {
      return this.publicationMapCache;
    }
    
    const query = `
      {
        publications(first: 10) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const response = await axios.post(
      this.graphqlUrl,
      { query },
      { headers: this.getHeaders() }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    const publicationMap = new Map<string, string>();
    response.data.data.publications.edges.forEach((edge: any) => {
      publicationMap.set(edge.node.name, edge.node.id);
    });
    
    // Cache the result
    this.publicationMapCache = publicationMap;
    return publicationMap;
  }

  async updateProductSalesChannels(productId: string, salesChannels: string[]): Promise<Product> {
    try {
      // Get publication IDs - this will use the cache if available
      const publicationMap = await this.getPublicationIds();
      
      // Format the product ID for GraphQL if it doesn't already have the prefix
      const gqlProductId = productId.startsWith('gid://shopify/Product/') 
        ? productId 
        : `gid://shopify/Product/${productId}`;
      
      // Create all the mutations in advance
      const mutations = [];
      
      for (const [channelName, publicationId] of publicationMap.entries()) {
        const shouldPublish = salesChannels.includes(channelName);
        
        if (shouldPublish) {
          mutations.push(`
            publishablePublish(
              id: "${gqlProductId}",
              input: {
                publicationId: "${publicationId}"
              }
            ) {
              publishable {
                ... on Product {
                  id
                }
              }
              userErrors {
                field
                message
              }
            }
          `);
        } else {
          mutations.push(`
            publishableUnpublish(
              id: "${gqlProductId}",
              input: {
                publicationId: "${publicationId}"
              }
            ) {
              publishable {
                ... on Product {
                  id
                }
              }
              userErrors {
                field
                message
              }
            }
          `);
        }
      }
      
      // Execute mutations in batches
      const batchSize = 5; // Number of mutations to execute at once
      for (let i = 0; i < mutations.length; i += batchSize) {
        const batch = mutations.slice(i, i + batchSize);
        
        // Create a batch mutation query
        const batchQuery = `
          mutation {
            ${batch.map((mutation, index) => `m${index}: ${mutation}`).join('\n')}
          }
        `;
        
        // Use the makeRequest method with retry logic instead of axios directly
        const response = await this.makeRequest(
          this.graphqlUrl,
          { query: batchQuery },
          3, // 3 retries
          60000 // 60 second timeout
        );

        if (response.data.errors) {
          console.error(`GraphQL errors for product ${productId}:`, JSON.stringify(response.data.errors));
          throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
        }
        
        // Check user errors in each mutation response
        const responseData = response.data.data;
        for (let j = 0; j < batch.length; j++) {
          const mutationKey = `m${j}`;
          if (responseData[mutationKey]?.userErrors?.length > 0) {
            const userError = responseData[mutationKey].userErrors[0];
            console.error(`User error for product ${productId}, mutation ${mutationKey}:`, JSON.stringify(userError));
            throw new Error(`Mutation error: ${userError.message}`);
          }
        }
      }

      // Skip fetching the updated product details to improve performance
      // Just return a basic product object with the ID
      return { id: productId } as Product;
    } catch (error) {
      // Log the detailed error
      console.error(`Failed to update product ${productId} sales channels:`, error);
      
      if (axios.isAxiosError(error)) {
        // Capture response data if available
        const responseData = error.response?.data;
        console.error(`Axios error details for product ${productId}:`, JSON.stringify({
          status: error.response?.status,
          statusText: error.response?.statusText,
          responseData: responseData
        }));
        throw new Error(`Failed to update product sales channels: ${error.message}. Status: ${error.response?.status}`);
      }
      throw new Error(`Failed to update product sales channels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async bulkUpdateSalesChannels(salesChannels: string[]): Promise<{ 
    success: boolean; 
    message: string; 
    operationId: string;
  }> {
    try {
      // Get publication IDs for the sales channels
      const publicationMap = await this.getPublicationIds();
      const publicationIdsToPublish = salesChannels
        .filter(channel => publicationMap.has(channel))
        .map(channel => publicationMap.get(channel)!);
      
      if (publicationIdsToPublish.length === 0) {
        throw new Error(`No valid publication IDs found for channels: ${salesChannels.join(', ')}`);
      }
      
      console.log(`Found ${publicationIdsToPublish.length} publication IDs for channels: ${salesChannels.join(', ')}`);
      
      // Create a bulk operation that will process all products
      const query = `
        mutation {
          bulkOperationRunQuery(
            query: """
              {
                products {
                  edges {
                    node {
                      id
                    }
                  }
                }
              }
            """
          ) {
            bulkOperation {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }
      `;
      
      // Use the makeRequest method with retry logic
      const response = await this.makeRequest(
        this.graphqlUrl,
        { query },
        3, // 3 retries
        60000 // 60 second timeout
      );
      
      if (response.data.errors) {
        console.error('GraphQL errors for bulk operation:', JSON.stringify(response.data.errors));
        throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
      }
      
      // Check if the expected structure exists
      if (!response.data.data || 
          !response.data.data.bulkOperationRunQuery || 
          !response.data.data.bulkOperationRunQuery.bulkOperation) {
        console.error('Unexpected response structure:', JSON.stringify(response.data));
        throw new Error('Bulk operation failed: Unexpected response structure from Shopify API');
      }
      
      const bulkOperation = response.data.data.bulkOperationRunQuery.bulkOperation;
      const operationId = bulkOperation.id;
      
      return {
        success: true,
        message: `Started bulk operation ${operationId} to get all products. Once completed, call the process-bulk-operation endpoint with this operation ID to publish products to channels: ${salesChannels.join(", ")}`,
        operationId
      };
    } catch (error) {
      console.error('Error starting bulk operation:', error);
      throw new Error(`Failed to start bulk update operation: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  async processBulkOperationForSalesChannels(operationId: string, salesChannels: string[]): Promise<{
    success: boolean;
    message: string;
    updatedCount: number;
    failedCount: number;
  }> {
    try {
      // First check if the operation is complete
      const status = await this.checkBulkOperationStatus(operationId);
      
      if (status.status !== 'COMPLETED') {
        throw new Error(`Bulk operation is not completed yet. Current status: ${status.status}`);
      }
      
      if (!status.url) {
        throw new Error('Bulk operation completed but no result URL available');
      }
      
      // Download the results file
      console.log(`Downloading bulk operation results from ${status.url}`);
      const response = await axios.get(status.url);
      const resultsData = response.data;
      
      // Process the results file - it's a JSONL file (one JSON object per line)
      const productIds: string[] = [];
      const lines = resultsData.trim().split('\n');
      
      for (const line of lines) {
        try {
          const product = JSON.parse(line);
          if (product.id) {
            // Extract the numeric ID from the gid
            const numericId = product.id.split('/').pop();
            productIds.push(numericId);
          }
        } catch (error) {
          console.error('Error parsing line:', line, error);
        }
      }
      
      console.log(`Found ${productIds.length} products to update`);
      
      // Get publication IDs for the sales channels
      const publicationMap = await this.getPublicationIds();
      const publicationIdsToPublish = salesChannels
        .filter(channel => publicationMap.has(channel))
        .map(channel => publicationMap.get(channel)!);
      
      // Now update the products in batches (MUCH faster than one-by-one)
      // Reduce batch size to avoid DOCUMENT_TOKEN_LIMIT_EXCEEDED error
      const batchSize = 15; // Reduce from 100 to 15 products per batch
      // Reduce the number of mutations per batch further when we have multiple channels
      const effectiveBatchSize = Math.max(5, Math.floor(20 / publicationIdsToPublish.length));
      
      console.log(`Using batch size of ${effectiveBatchSize} products with ${publicationIdsToPublish.length} channels`);
      
      let updatedCount = 0;
      let failedCount = 0;
      const errorMap = new Map<string, number>();
      
      for (let i = 0; i < productIds.length; i += effectiveBatchSize) {
        const batch = productIds.slice(i, i + effectiveBatchSize);
        
        // Log progress every 100 products
        if (i % 100 === 0 || i === 0) {
          console.log(`Processing products ${i + 1}-${Math.min(i + effectiveBatchSize, productIds.length)} of ${productIds.length}`);
        }
        
        try {
          // Build a mutation with all products in the batch
          const mutations: string[] = [];
          
          // For each product, create a publish mutation for each channel
          for (let j = 0; j < batch.length; j++) {
            const productId = batch[j];
            const gqlProductId = `gid://shopify/Product/${productId}`;
            
            // Add a publish mutation for each publication
            for (let k = 0; k < publicationIdsToPublish.length; k++) {
              const publicationId = publicationIdsToPublish[k];
              mutations.push(`
                m${j}_${k}: publishablePublish(
                  id: "${gqlProductId}",
                  input: {
                    publicationId: "${publicationId}"
                  }
                ) {
                  publishable {
                    ... on Product {
                      id
                    }
                  }
                  userErrors {
                    field
                    message
                  }
                }
              `);
            }
          }
          
          // Create a batch mutation query with all operations
          const batchQuery = `
            mutation {
              ${mutations.join('\n')}
            }
          `;
          
          // Execute the bulk mutations
          const response = await this.makeRequest(
            this.graphqlUrl,
            { query: batchQuery },
            3, // 3 retries
            120000 // 2 minute timeout for large batches
          );
          
          if (response.data.errors) {
            failedCount += batch.length;
            console.error(`GraphQL errors processing batch:`, JSON.stringify(response.data.errors));
            const errorMessage = response.data.errors[0].message;
            const currentCount = errorMap.get(errorMessage) || 0;
            errorMap.set(errorMessage, currentCount + batch.length);
          } else {
            updatedCount += batch.length;
          }
        } catch (error) {
          failedCount += batch.length;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const currentCount = errorMap.get(errorMessage) || 0;
          errorMap.set(errorMessage, currentCount + batch.length);
          console.error(`Error processing batch:`, errorMessage);
        }
        
        // Add a small delay between batches to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Build error summary for the response message
      let errorSummary = '';
      if (errorMap.size > 0) {
        errorSummary = '\nError summary:\n' + 
          Array.from(errorMap.entries())
            .map(([error, count]) => `- ${error}: ${count} products`)
            .join('\n');
      }
      
      return {
        success: failedCount === 0,
        message: `Updated ${updatedCount} products to sales channels: ${salesChannels.join(', ')}. Failed: ${failedCount} products.${errorSummary}`,
        updatedCount,
        failedCount
      };
    } catch (error) {
      console.error('Error processing bulk operation results:', error);
      throw new Error(`Failed to process bulk operation results: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  async checkBulkOperationStatus(operationId: string): Promise<{
    status: string;
    completedAt?: string;
    objectCount?: number;
    url?: string;
    errorCode?: string;
  }> {
    const query = `
      {
        node(id: "${operationId}") {
          ... on BulkOperation {
            id
            status
            errorCode
            createdAt
            completedAt
            objectCount
            fileSize
            url
            partialDataUrl
          }
        }
      }
    `;

    const response = await this.makeRequest(
      this.graphqlUrl,
      { query },
      3,
      30000
    );

    if (response.data.errors) {
      throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
    }

    const operation = response.data.data.node;
    return {
      status: operation.status,
      completedAt: operation.completedAt,
      objectCount: operation.objectCount,
      url: operation.url || operation.partialDataUrl,
      errorCode: operation.errorCode
    };
  }

  async updateGoogleAttributes(entityId: string, attributes: GoogleProductAttributes): Promise<boolean> {
    try {
      // Check if this is a variant ID
      const isVariant = entityId.includes('gid://shopify/ProductVariant/');
      
      // Format the ID correctly for GraphQL
      let gqlId = entityId;
      if (!isVariant && !entityId.includes('gid://shopify/Product/')) {
        gqlId = `gid://shopify/Product/${entityId}`;
      }
      
      // Create the mutations for each attribute
      const mutations = [];
      
      // For product level, collect all metafields to update in a single mutation
      const productMetafields = [];
      // For variant level, collect all metafields to update in a single mutation
      const variantMetafields = [];
      
      for (const [key, value] of Object.entries(attributes)) {
        // Skip empty values
        if (!value) {
          continue;
        }
        
        // Skip category for variants (it's product-level)
        if (isVariant && key === 'google_product_category') {
          continue;
        }
        
        // Create metafield input for each attribute
        const metafieldInput = {
          namespace: "mm-google-shopping",
          key: key,
          value: value,
          type: "single_line_text_field"
        };
        
        if (isVariant) {
          variantMetafields.push(metafieldInput);
        } else {
          productMetafields.push(metafieldInput);
        }
      }
      
      // Create product metafields mutation if we have any product metafields
      if (!isVariant && productMetafields.length > 0) {
        mutations.push(`
          productUpdate(
            input: {
              id: "${gqlId}",
              metafields: [
                ${productMetafields.map(mf => `{
                  namespace: "${mf.namespace}",
                  key: "${mf.key}",
                  value: "${mf.value}",
                  type: "${mf.type}"
                }`).join(',')}
              ]
            }
          ) {
            product {
              id
            }
            userErrors {
              field
              message
            }
          }
        `);
      }
      
      // Create variant metafields mutation if we have any variant metafields
      if (isVariant && variantMetafields.length > 0) {
        mutations.push(`
          productVariantUpdate(
            input: {
              id: "${gqlId}",
              metafields: [
                ${variantMetafields.map(mf => `{
                  namespace: "${mf.namespace}",
                  key: "${mf.key}",
                  value: "${mf.value}",
                  type: "${mf.type}"
                }`).join(',')}
              ]
            }
          ) {
            productVariant {
              id
            }
            userErrors {
              field
              message
            }
          }
        `);
      }
      
      // If we don't have any mutations (e.g., all values were empty), return success
      if (mutations.length === 0) {
        return true;
      }
      
      // Execute mutations in batches
      const batchSize = 5; // Number of mutations to execute at once
      for (let i = 0; i < mutations.length; i += batchSize) {
        const batch = mutations.slice(i, i + batchSize);
        
        // Create a batch mutation query
        const batchQuery = `
          mutation {
            ${batch.map((mutation, index) => `m${index}: ${mutation}`).join('\n')}
          }
        `;
        
        // Use the makeRequest method with retry logic
        const response = await this.makeRequest(
          this.graphqlUrl,
          { query: batchQuery },
          3, // 3 retries
          60000 // 60 second timeout
        );

        if (response.data.errors) {
          console.error(`GraphQL errors for ${isVariant ? 'variant' : 'product'} ${entityId}:`, JSON.stringify(response.data.errors));
          throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
        }
        
        // Check user errors in each mutation response
        const responseData = response.data.data;
        for (let j = 0; j < batch.length; j++) {
          const mutationKey = `m${j}`;
          if (responseData[mutationKey]?.userErrors?.length > 0) {
            const userError = responseData[mutationKey].userErrors[0];
            console.error(`User error for ${isVariant ? 'variant' : 'product'} ${entityId}, mutation ${mutationKey}:`, JSON.stringify(userError));
            throw new Error(`Mutation error: ${userError.message}`);
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Error updating Google attributes for ${entityId}:`, error);
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to update Google attributes: ${error.message}`);
      }
      throw new Error('Failed to update Google attributes');
    }
  }

  async getProductsMissingChannels(): Promise<string[]> {
    try {
      // Get all available sales channels
      const allSalesChannels = await this.getAllSalesChannels();
      console.log(`Found ${allSalesChannels.length} total sales channels`);
      
      // We'll use bulk queries with pagination to efficiently process products
      const productsMissingChannels: string[] = [];
      let hasNextPage = true;
      let cursor: string | undefined;
      const pageSize = 50; // Process 50 products at a time in bulk
      
      console.log(`Starting to query products in batches of ${pageSize}...`);
      
      // Process products in pages
      while (hasNextPage) {
        try {
          // Construct a bulk query that processes multiple products at once
          const query = `
            {
              products(first: ${pageSize}${cursor ? `, after: "${cursor}"` : ''}) {
                edges {
                  node {
                    id
                    title
                    productPublications(first: ${allSalesChannels.length}) {
                      edges {
                        node {
                          channel {
                            id
                            name
                          }
                        }
                      }
                    }
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
          
          // Make the request with our rate limiting and retry logic
          const response = await this.makeRequest(
            this.graphqlUrl,
            { query },
            3, // retries
            60000 // longer timeout for bulk query
          );
          
          if (response.data.errors) {
            console.error('GraphQL query errors:', response.data.errors);
            // Continue to next page despite errors
          } else {
            // Process the batch of products
            const products = response.data.data.products.edges;
            hasNextPage = response.data.data.products.pageInfo.hasNextPage;
            
            if (products.length > 0) {
              // Update cursor for next page
              cursor = products[products.length - 1].cursor;
              
              // Process each product in the batch
              for (const product of products) {
                const productId = product.node.id.split('/').pop();
                const publicationsEdges = product.node.productPublications?.edges || [];
                const productChannels = publicationsEdges.map((edge: any) => edge.node.channel.name);
                
                // Check if this product is missing Google & YouTube or TikTok channels
                const hasGoogleYouTube = productChannels.some(
                  (channel: string) => channel.toLowerCase().includes('google') && channel.toLowerCase().includes('youtube')
                );
                const hasTikTok = productChannels.some(
                  (channel: string) => channel.toLowerCase().includes('tiktok')
                );
                
                if (!hasGoogleYouTube || !hasTikTok) {
                  productsMissingChannels.push(productId);
                }
              }
              
              console.log(`Processed ${products.length} products, found ${productsMissingChannels.length} missing Google & YouTube or TikTok channels so far`);
            } else {
              console.log('No products returned in this batch, ending pagination');
              hasNextPage = false;
            }
          }
          
          // Add a small delay between pages to avoid rate limiting
          if (hasNextPage) {
            const delay = 500; // Reduced delay (500ms instead of 2000ms)
            console.log(`Waiting ${delay}ms before fetching next page...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error('Error processing product batch:', error);
          
          // If we encounter an error, reduce the page size and retry
          if (pageSize > 10) {
            console.log('Reducing page size and trying again...');
            return this.getProductsMissingChannelsWithSmallerBatches(allSalesChannels, pageSize / 2, cursor);
          }
          
          // If we're already at a small page size, re-throw the error
          throw error;
        }
      }
      
      console.log(`Completed scan. Found ${productsMissingChannels.length} products missing Google & YouTube or TikTok channels.`);
      return productsMissingChannels;
    } catch (error) {
      console.error('Error in getProductsMissingChannels:', error);
      throw new Error(`Failed to fetch products missing channels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
  
  // Fallback method with smaller batch size in case of failures
  private async getProductsMissingChannelsWithSmallerBatches(
    allSalesChannels: string[],
    pageSize: number,
    startCursor?: string
  ): Promise<string[]> {
    console.log(`Retrying with smaller batch size: ${pageSize}`);
    
    const productsMissingChannels: string[] = [];
    let hasNextPage = true;
    let cursor = startCursor;
    
    while (hasNextPage) {
      // Similar implementation but with smaller batches
      const query = `
        {
          products(first: ${pageSize}${cursor ? `, after: "${cursor}"` : ''}) {
            edges {
              node {
                id
                productPublications(first: ${allSalesChannels.length}) {
                  edges {
                    node {
                      channel {
                        name
                      }
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      try {
        const response = await this.makeRequest(
          this.graphqlUrl,
          { query },
          3,
          30000
        );
        
        const products = response.data.data.products.edges;
        hasNextPage = response.data.data.products.pageInfo.hasNextPage;
        
        if (products.length > 0) {
          cursor = products[products.length - 1].cursor;
          
          for (const product of products) {
            const productId = product.node.id.split('/').pop();
            const publicationsEdges = product.node.productPublications?.edges || [];
            const productChannels = publicationsEdges.map((edge: any) => edge.node.channel.name);
            
            // Check if this product is missing Google & YouTube or TikTok channels
            const hasGoogleYouTube = productChannels.some(
              (channel: string) => channel.toLowerCase().includes('google') && channel.toLowerCase().includes('youtube')
            );
            const hasTikTok = productChannels.some(
              (channel: string) => channel.toLowerCase().includes('tiktok')
            );
            
            if (!hasGoogleYouTube || !hasTikTok) {
              productsMissingChannels.push(productId);
            }
          }
          
          console.log(`Processed ${products.length} products, found ${productsMissingChannels.length} missing Google & YouTube or TikTok channels so far`);
        } else {
          hasNextPage = false;
        }
        
        // Slightly longer delay for the fallback method
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Error in fallback method:', error);
        throw error;
      }
    }
    
    return productsMissingChannels;
  }

  async getProductsWithGoogleYouTubeErrors(): Promise<string[]> {
    try {
      console.log(`Starting to fetch products with Google & YouTube shopping errors...`);
      
      // We'll use bulk queries with pagination to efficiently process products
      const productsWithIssues: string[] = [];
      let hasNextPage = true;
      let cursor: string | undefined;
      const pageSize = 25; // Reduced from 50 to 25 to avoid throttling
      
      // Get publication ID for Google & YouTube
      const publicationMap = await this.getPublicationIds();
      const googleYoutubePublication = Array.from(publicationMap.entries())
        .find(([name]) => name.toLowerCase().includes('google') && name.toLowerCase().includes('youtube'));
        
      if (!googleYoutubePublication) {
        throw new Error('Could not find Google & YouTube publication ID');
      }
      
      const googleYoutubePublicationId = googleYoutubePublication[1];
      
      console.log(`Found publication ID: Google & YouTube=${googleYoutubePublicationId}`);
      console.log(`Starting to query products in batches of ${pageSize}...`);
      
      // Process products in pages
      let currentPage = 1;
      while (hasNextPage) {
        try {
          console.log(`Processing page ${currentPage}...`);
          
          // Construct a bulk query that processes multiple products at once
          // Only check mm-google-shopping namespace
          const query = `
            {
              products(first: ${pageSize}${cursor ? `, after: "${cursor}"` : ''}) {
                edges {
                  node {
                    id
                    title
                    productPublications(first: 20) {
                      edges {
                        node {
                          channel {
                            id
                            name
                          }
                          publishDate
                          isPublished
                        }
                      }
                    }
                    metafields(first: 20, namespace: "mm-google-shopping") {
                      edges {
                        node {
                          key
                          value
                        }
                      }
                    }
                    variants(first: 10) {
                      edges {
                        node {
                          id
                          title
                          metafields(first: 20, namespace: "mm-google-shopping") {
                            edges {
                              node {
                                key
                                value
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `;
          
          // Make the request with our rate limiting and retry logic
          const response = await this.makeRequest(
            this.graphqlUrl,
            { query },
            5, // increased retries
            90000 // increased timeout
          );
          
          if (response.data.errors) {
            console.error('GraphQL query errors:', response.data.errors);
            
            // Check if the error is due to throttling
            const isThrottled = response.data.errors.some((error: any) => 
              error.extensions?.code === 'THROTTLED' || error.message.includes('Throttled')
            );
            
            if (isThrottled) {
              // Wait significantly longer when throttled (10 seconds)
              console.log('Rate limited by Shopify API, waiting 10 seconds before retrying...');
              await new Promise(resolve => setTimeout(resolve, 10000));
              continue; // Retry the same page without advancing the cursor
            }
            
            // Continue to next page despite other errors
          } else {
            // Process the batch of products
            const products = response.data.data.products.edges;
            hasNextPage = response.data.data.products.pageInfo.hasNextPage;
            
            if (products.length > 0) {
              // Update cursor for next page
              cursor = products[products.length - 1].cursor;
              
              // Process each product in the batch
              for (const product of products) {
                const productId = product.node.id.split('/').pop();
                const publications = product.node.productPublications?.edges || [];
                const productMetafields = product.node.metafields?.edges || [];
                const variants = product.node.variants?.edges || [];
                
                // Check if product has Google & YouTube channel
                const hasGoogleYoutubeChannel = publications.some((pub: any) => {
                  const channelName = pub.node.channel?.name || '';
                  return channelName.toLowerCase().includes('google') && channelName.toLowerCase().includes('youtube');
                });
                
                // Only check products published to Google & YouTube
                if (hasGoogleYoutubeChannel) {
                  // Check for required attributes based on number of variants
                  const isMultiVariant = variants.length > 1;
                  
                  if (isMultiVariant) {
                    // Multi-variant products: 
                    // - Require category at product level
                    // - At least one variant needs all other attributes
                    
                    // Check for google_product_category at product level
                    const hasCategory = productMetafields.some(
                      (m: any) => m.node.key === 'google_product_category' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    if (!hasCategory) {
                      productsWithIssues.push(productId);
                      continue;
                    }
                    
                    // Check if any variant has all required attributes
                    let anyVariantHasAllAttributes = false;
                    
                    for (const variant of variants) {
                      const variantMetafields = variant.node.metafields?.edges || [];
                      
                      // Check for required variant-level metafields
                      const hasColor = variantMetafields.some(
                        (m: any) => m.node.key === 'color' && m.node.value && m.node.value.trim() !== ''
                      );
                      
                      const hasSize = variantMetafields.some(
                        (m: any) => m.node.key === 'size' && m.node.value && m.node.value.trim() !== ''
                      );
                      
                      const hasGender = variantMetafields.some(
                        (m: any) => m.node.key === 'gender' && m.node.value && m.node.value.trim() !== ''
                      );
                      
                      const hasAgeGroup = variantMetafields.some(
                        (m: any) => m.node.key === 'age_group' && m.node.value && m.node.value.trim() !== ''
                      );
                      
                      if (hasColor && hasSize && hasGender && hasAgeGroup) {
                        anyVariantHasAllAttributes = true;
                        break;
                      }
                    }
                    
                    if (!anyVariantHasAllAttributes) {
                      productsWithIssues.push(productId);
                    }
                  } else {
                    // Single-variant products:
                    // - All attributes at product level
                    
                    const hasCategory = productMetafields.some(
                      (m: any) => m.node.key === 'google_product_category' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    const hasColor = productMetafields.some(
                      (m: any) => m.node.key === 'color' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    const hasSize = productMetafields.some(
                      (m: any) => m.node.key === 'size' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    const hasGender = productMetafields.some(
                      (m: any) => m.node.key === 'gender' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    const hasAgeGroup = productMetafields.some(
                      (m: any) => m.node.key === 'age_group' && m.node.value && m.node.value.trim() !== ''
                    );
                    
                    if (!hasCategory || !hasColor || !hasSize || !hasGender || !hasAgeGroup) {
                      productsWithIssues.push(productId);
                    }
                  }
                }
              }
              
              console.log(`Processed ${products.length} products, found ${productsWithIssues.length} with Google & YouTube shopping errors so far`);
              
              // Increment page counter for logging
              currentPage++;
            } else {
              console.log('No products returned in this batch, ending pagination');
              hasNextPage = false;
            }
          }
          
          // Add a longer delay between pages to avoid rate limiting
          if (hasNextPage) {
            const delay = 2000;
            console.log(`Waiting ${delay}ms before fetching next page...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        } catch (error) {
          console.error('Error processing product batch:', error);
          
          // If we encounter an error, reduce the page size and retry
          if (pageSize > 10) {
            console.log('Reducing page size and trying again...');
            return this.getProductsWithGoogleYouTubeErrorsWithSmallerBatches(pageSize / 2, cursor);
          }
          
          // If we're already at a small page size, re-throw the error
          throw error;
        }
      }
      
      console.log(`Completed scan. Found ${productsWithIssues.length} products with Google & YouTube shopping errors.`);
      return productsWithIssues;
    } catch (error) {
      console.error('Error in getProductsWithGoogleYouTubeErrors:', error);
      throw new Error(`Failed to fetch products with Google & YouTube errors: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getProductsWithGoogleYouTubeErrorsWithSmallerBatches(
    pageSize: number,
    startCursor?: string
  ): Promise<string[]> {
    console.log(`Retrying with smaller batch size: ${pageSize}`);
    
    // Setup for pagination
    const productsWithIssues: string[] = [];
    let hasNextPage = true;
    let cursor = startCursor;
    
    // Get publication ID for Google & YouTube
    const publicationMap = await this.getPublicationIds();
    const googleYoutubePublication = Array.from(publicationMap.entries())
      .find(([name]) => name.toLowerCase().includes('google') && name.toLowerCase().includes('youtube'));
      
    if (!googleYoutubePublication) {
      throw new Error('Could not find Google & YouTube publication ID');
    }
    
    const googleYoutubePublicationId = googleYoutubePublication[1];
    
    // Process products in pages
    while (hasNextPage) {
      const query = `
        {
          products(first: ${pageSize}${cursor ? `, after: "${cursor}"` : ''}) {
            edges {
              node {
                id
                title
                productPublications(first: 20) {
                  edges {
                    node {
                      channel {
                        id
                        name
                      }
                      publishDate
                      isPublished
                    }
                  }
                }
                metafields(first: 20, namespace: "mm-google-shopping") {
                  edges {
                    node {
                      key
                      value
                    }
                  }
                }
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      metafields(first: 20, namespace: "mm-google-shopping") {
                        edges {
                          node {
                            key
                            value
                          }
                        }
                      }
                    }
                  }
                }
              }
              cursor
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `;
      
      try {
        const response = await this.makeRequest(
          this.graphqlUrl,
          { query },
          3,
          30000
        );
        
        const products = response.data.data.products.edges;
        hasNextPage = response.data.data.products.pageInfo.hasNextPage;
        
        if (products.length > 0) {
          cursor = products[products.length - 1].cursor;
          
          for (const product of products) {
            const productId = product.node.id.split('/').pop();
            const publications = product.node.productPublications?.edges || [];
            const productMetafields = product.node.metafields?.edges || [];
            const variants = product.node.variants?.edges || [];
            
            // Check if product has Google & YouTube channel
            const hasGoogleYoutubeChannel = publications.some((pub: any) => {
              const channelName = pub.node.channel?.name || '';
              return channelName.toLowerCase().includes('google') && channelName.toLowerCase().includes('youtube');
            });
            
            // Only check products published to Google & YouTube
            if (hasGoogleYoutubeChannel) {
              // Check for required attributes based on number of variants
              const isMultiVariant = variants.length > 1;
              
              if (isMultiVariant) {
                // Multi-variant products: 
                // - Require category at product level
                // - At least one variant needs all other attributes
                
                // Check for google_product_category at product level
                const hasCategory = productMetafields.some(
                  (m: any) => m.node.key === 'google_product_category' && m.node.value && m.node.value.trim() !== ''
                );
                
                if (!hasCategory) {
                  productsWithIssues.push(productId);
                  continue;
                }
                
                // Check if any variant has all required attributes
                let anyVariantHasAllAttributes = false;
                
                for (const variant of variants) {
                  const variantMetafields = variant.node.metafields?.edges || [];
                  
                  // Check for required variant-level metafields
                  const hasColor = variantMetafields.some(
                    (m: any) => m.node.key === 'color' && m.node.value && m.node.value.trim() !== ''
                  );
                  
                  const hasSize = variantMetafields.some(
                    (m: any) => m.node.key === 'size' && m.node.value && m.node.value.trim() !== ''
                  );
                  
                  const hasGender = variantMetafields.some(
                    (m: any) => m.node.key === 'gender' && m.node.value && m.node.value.trim() !== ''
                  );
                  
                  const hasAgeGroup = variantMetafields.some(
                    (m: any) => m.node.key === 'age_group' && m.node.value && m.node.value.trim() !== ''
                  );
                  
                  if (hasColor && hasSize && hasGender && hasAgeGroup) {
                    anyVariantHasAllAttributes = true;
                    break;
                  }
                }
                
                if (!anyVariantHasAllAttributes) {
                  productsWithIssues.push(productId);
                }
              } else {
                // Single-variant products:
                // - All attributes at product level
                
                const hasCategory = productMetafields.some(
                  (m: any) => m.node.key === 'google_product_category' && m.node.value && m.node.value.trim() !== ''
                );
                
                const hasColor = productMetafields.some(
                  (m: any) => m.node.key === 'color' && m.node.value && m.node.value.trim() !== ''
                );
                
                const hasSize = productMetafields.some(
                  (m: any) => m.node.key === 'size' && m.node.value && m.node.value.trim() !== ''
                );
                
                const hasGender = productMetafields.some(
                  (m: any) => m.node.key === 'gender' && m.node.value && m.node.value.trim() !== ''
                );
                
                const hasAgeGroup = productMetafields.some(
                  (m: any) => m.node.key === 'age_group' && m.node.value && m.node.value.trim() !== ''
                );
                
                if (!hasCategory || !hasColor || !hasSize || !hasGender || !hasAgeGroup) {
                  productsWithIssues.push(productId);
                }
              }
            }
          }
          
          console.log(`Processed ${products.length} products, found ${productsWithIssues.length} with Google & YouTube shopping errors so far`);
        } else {
          hasNextPage = false;
        }
        
        // Slightly longer delay for the fallback method
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch (error) {
        console.error('Error in fallback method:', error);
        throw error;
      }
    }
    
    return productsWithIssues;
  }

  async getProductsWithFaireSalesChannel(): Promise<string[]> {
    try {
      console.log('Getting products with Faire: Sell Wholesale sales channel');
      
      // First get publications to find the Faire publication ID
      const query = `
        {
          publications(first: 20) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `;
      
      const response = await this.makeRequest(
        this.graphqlUrl,
        { query },
        3,
        30000
      );
      
      if (response.data.errors) {
        console.error('GraphQL errors getting publications:', JSON.stringify(response.data.errors));
        throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
      }
      
      // Find the Faire publication
      const publications = response.data.data.publications.edges;
      console.log(`Found ${publications.length} publications:`);
      publications.forEach((pub: any) => {
        console.log(`- ${pub.node.name} (${pub.node.id})`);
      });
      
      const fairePublication = publications.find((edge: any) => 
        edge.node.name === 'Faire: Sell Wholesale'
      );
      
      if (!fairePublication) {
        throw new Error('Faire: Sell Wholesale publication not found');
      }
      
      const fairePublicationId = fairePublication.node.id;
      console.log(`Found Faire publication ID: ${fairePublicationId}`);
      
      // Use pagination to fetch all products, then filter those published to Faire
      const faireProductIds: string[] = [];
      let hasNextPage = true;
      let cursor = null;
      const pageSize = 250; // Maximum allowed by Shopify
      
      console.log('Starting to fetch products and checking for Faire publication...');
      
      while (hasNextPage) {
        // Query products with their publications
        const productsQuery = `
          {
            products(first: ${pageSize}${cursor ? `, after: "${cursor}"` : ''}) {
              pageInfo {
                hasNextPage
              }
              edges {
                cursor
                node {
                  id
                  title
                  publishedOnPublication(publicationId: "${fairePublicationId}")
                }
              }
            }
          }
        `;
        
        const productsResponse = await this.makeRequest(
          this.graphqlUrl,
          { query: productsQuery },
          3,
          60000
        );
        
        if (productsResponse.data.errors) {
          console.error('GraphQL errors fetching products:', JSON.stringify(productsResponse.data.errors));
          throw new Error(`GraphQL error: ${productsResponse.data.errors[0].message}`);
        }
        
        const productsData = productsResponse.data.data.products;
        const edges = productsData.edges || [];
        
        if (edges.length > 0) {
          // Get the cursor for the next page
          cursor = edges[edges.length - 1].cursor;
          
          // Extract product IDs for those published to Faire
          let faireBatchCount = 0;
          for (const edge of edges) {
            if (edge.node.publishedOnPublication === true) {
              const numericId = edge.node.id.split('/').pop();
              faireProductIds.push(numericId);
              faireBatchCount++;
            }
          }
          
          console.log(`Fetched ${edges.length} products, found ${faireBatchCount} with Faire publication in this batch. Total so far: ${faireProductIds.length}`);
        }
        
        // Check if there are more pages
        hasNextPage = productsData.pageInfo.hasNextPage;
        
        // Add a small delay to avoid rate limiting
        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      console.log(`Found ${faireProductIds.length} products published to Faire: Sell Wholesale sales channel`);
      return faireProductIds;
    } catch (error) {
      console.error('Error getting products with Faire channel:', error);
      throw error;
    }
  }

  /**
   * Execute a GraphQL query with retry logic
   * This is a public wrapper around the private makeRequest method
   */
  public async executeGraphQLQuery(
    query: string,
    maxRetries: number = 3,
    timeout: number = 30000
  ): Promise<any> {
    return this.makeRequest(
      this.graphqlUrl,
      { query },
      maxRetries,
      timeout
    );
  }
}