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
    tokens: 50,  // Start with full tokens
    lastRefill: Date.now(),
    maxTokens: 50,
    refillRate: 2, // Tokens per second to refill
  };

  constructor() {
    this.baseUrl = env.storeApiUrl;
    this.apiKey = env.storeApiKey;
    
    // Extract shop domain from the REST API URL
    // From: https://your-store.myshopify.com/admin/api/2024-04/products.json
    // To: https://your-store.myshopify.com/admin/api/2024-01/graphql.json
    const shopUrl = this.baseUrl.split('/admin')[0];
    this.graphqlUrl = `${shopUrl}/admin/api/2024-01/graphql.json`;
    
    if (!this.baseUrl) {
      throw new Error('STORE_API_URL environment variable is not set');
    }
    if (!this.apiKey) {
      throw new Error('STORE_API_KEY environment variable is not set');
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
      return true;
    } else {
      // Calculate wait time needed to have enough tokens
      const waitTimeMs = ((cost - this.tokenBucket.tokens) / this.tokenBucket.refillRate) * 1000;
      console.log(`Rate limiting ourselves, waiting ${waitTimeMs.toFixed(0)}ms before processing next request`);
      await new Promise(resolve => setTimeout(resolve, waitTimeMs));
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
      
      // Format the product ID for GraphQL
      const gqlProductId = `gid://shopify/Product/${productId}`;
      
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
    updatedProducts: string[]; 
    failedProducts: string[]; 
  }> {
    try {
      const productIds = await this.getAllProducts();
      const updatedProducts: string[] = [];
      const failedProducts: string[] = [];
      const batchSize = 10; // Process 10 products at a time

      // Process products in batches
      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        const updatePromises = batch.map(async (productId) => {
          try {
            await this.updateProductSalesChannels(productId, salesChannels);
            updatedProducts.push(productId);
          } catch (error) {
            failedProducts.push(productId);
          }
        });

        await Promise.all(updatePromises);
      }

      const message = `Updated ${updatedProducts.length} products${failedProducts.length > 0 ? `, ${failedProducts.length} products failed` : ''}`;
      
      return {
        success: failedProducts.length === 0,
        message,
        updatedProducts,
        failedProducts
      };
    } catch (error) {
      throw new Error(`Failed to bulk update sales channels: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async updateGoogleAttributes(productId: string, attributes: GoogleProductAttributes): Promise<Product> {
    try {
      const { category, color, size, gender, ageGroup } = attributes;
      
      // Format the product ID for GraphQL
      const gqlProductId = `gid://shopify/Product/${productId}`;
      
      // Construct metafield array, only including attributes that are defined
      const metafieldEntries = [];

      if (category) {
        metafieldEntries.push(`{namespace: "google", key: "google_product_category", value: "${category}", type: "single_line_text_field"}`);
      }
      
      if (color) {
        metafieldEntries.push(`{namespace: "google", key: "color", value: "${color}", type: "single_line_text_field"}`);
      }
      
      if (size) {
        metafieldEntries.push(`{namespace: "google", key: "size", value: "${size}", type: "single_line_text_field"}`);
      }
      
      if (gender) {
        metafieldEntries.push(`{namespace: "google", key: "gender", value: "${gender}", type: "single_line_text_field"}`);
      }
      
      if (ageGroup) {
        metafieldEntries.push(`{namespace: "google", key: "age_group", value: "${ageGroup}", type: "single_line_text_field"}`);
      }
      
      // Skip if no attributes are provided
      if (metafieldEntries.length === 0) {
        console.log(`No attributes provided for product ${productId}, skipping update`);
        return { id: productId } as Product;
      }
      
      const query = `
        mutation {
          productUpdate(input: {
            id: "${gqlProductId}",
            metafields: [
              ${metafieldEntries.join(',\n              ')}
            ]
          }) {
            product {
              id
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
        console.error(`GraphQL errors for product ${productId}:`, JSON.stringify(response.data.errors));
        throw new Error(`GraphQL error: ${response.data.errors[0].message}`);
      }
      
      const userErrors = response.data.data.productUpdate.userErrors;
      if (userErrors && userErrors.length > 0) {
        const userError = userErrors[0];
        console.error(`User error updating Google attributes for product ${productId}:`, JSON.stringify(userError));
        throw new Error(`Mutation error: ${userError.message}`);
      }
      
      return { id: productId } as Product;
    } catch (error) {
      console.error(`Failed to update Google attributes for product ${productId}:`, error);
      throw new Error(`Failed to update Google attributes: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
                
                // Check if this product is missing any channels
                if (productChannels.length < allSalesChannels.length) {
                  productsMissingChannels.push(productId);
                }
              }
              
              console.log(`Processed ${products.length} products, found ${productsMissingChannels.length} with missing channels so far`);
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
      
      console.log(`Completed scan. Found ${productsMissingChannels.length} products missing channels.`);
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
            
            if (productChannels.length < allSalesChannels.length) {
              productsMissingChannels.push(productId);
            }
          }
          
          console.log(`Processed ${products.length} products, found ${productsMissingChannels.length} with missing channels so far`);
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
      console.log(`Starting to fetch products with missing or incorrect Google & YouTube attributes...`);
      
      // We'll use bulk queries with pagination to efficiently process products
      const productsWithIssues: string[] = [];
      let hasNextPage = true;
      let cursor: string | undefined;
      const pageSize = 50; // Process 50 products at a time in bulk
      
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
                    metafields(first: 10, namespace: "google") {
                      edges {
                        node {
                          key
                          value
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
                const publications = product.node.productPublications?.edges || [];
                const metafields = product.node.metafields?.edges || [];
                
                // Check if product has Google & YouTube channel
                const hasGoogleYoutubeChannel = publications.some((pub: any) => {
                  const channelName = pub.node.channel?.name || '';
                  return channelName.toLowerCase().includes('google') && channelName.toLowerCase().includes('youtube');
                });
                
                // If product has the Google & YouTube channel, check required Google attributes
                if (hasGoogleYoutubeChannel) {
                  // Required Google attributes
                  const requiredAttributes = ['google_product_category', 'color', 'size', 'gender', 'age_group'];
                  const missingAttributes = [];
                  
                  // Check which attributes are missing or empty
                  for (const attr of requiredAttributes) {
                    const metafield = metafields.find((m: any) => m.node.key === attr);
                    if (!metafield || !metafield.node.value.trim()) {
                      missingAttributes.push(attr);
                    }
                  }
                  
                  // If any required attributes are missing, add to the list
                  if (missingAttributes.length > 0) {
                    productsWithIssues.push(productId);
                  }
                }
              }
              
              console.log(`Processed ${products.length} products, found ${productsWithIssues.length} with missing Google & YouTube attributes so far`);
            } else {
              console.log('No products returned in this batch, ending pagination');
              hasNextPage = false;
            }
          }
          
          // Add a small delay between pages to avoid rate limiting
          if (hasNextPage) {
            const delay = 500;
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
      
      console.log(`Completed scan. Found ${productsWithIssues.length} products with missing Google & YouTube attributes.`);
      return productsWithIssues;
    } catch (error) {
      console.error('Error in getProductsWithGoogleYouTubeErrors:', error);
      throw new Error(`Failed to fetch products with Google & YouTube attribute issues: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async getProductsWithGoogleYouTubeErrorsWithSmallerBatches(
    pageSize: number,
    startCursor?: string
  ): Promise<string[]> {
    console.log(`Retrying with smaller batch size: ${pageSize}`);
    
    // Same implementation but with smaller batch size, simplified version of the main method
    // This is a fallback for when we encounter errors with larger batches
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
                metafields(first: 10, namespace: "google") {
                  edges {
                    node {
                      key
                      value
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
            const metafields = product.node.metafields?.edges || [];
            
            // Check if product has Google & YouTube channel
            const hasGoogleYoutubeChannel = publications.some((pub: any) => {
              const channelName = pub.node.channel?.name || '';
              return channelName.toLowerCase().includes('google') && channelName.toLowerCase().includes('youtube');
            });
            
            // If product has the Google & YouTube channel, check required Google attributes
            if (hasGoogleYoutubeChannel) {
              // Required Google attributes
              const requiredAttributes = ['google_product_category', 'color', 'size', 'gender', 'age_group'];
              const missingAttributes = [];
              
              // Check which attributes are missing or empty
              for (const attr of requiredAttributes) {
                const metafield = metafields.find((m: any) => m.node.key === attr);
                if (!metafield || !metafield.node.value.trim()) {
                  missingAttributes.push(attr);
                }
              }
              
              // If any required attributes are missing, add to the list
              if (missingAttributes.length > 0) {
                productsWithIssues.push(productId);
              }
            }
          }
          
          console.log(`Processed ${products.length} products, found ${productsWithIssues.length} with missing Google & YouTube attributes so far`);
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
} 
