import axios from 'axios';
import { Product } from '../types/product';

export class StoreService {
  private baseUrl: string;
  private apiKey: string;
  private graphqlUrl: string;

  constructor() {
    this.baseUrl = process.env.STORE_API_URL || '';
    this.apiKey = process.env.STORE_API_KEY || '';
    
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

  async getAllProducts(): Promise<string[]> {
    try {
      const query = `
        query {
          products(first: 250) {
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

      // Extract just the numeric IDs from the GraphQL global IDs
      const productIds = response.data.data.products.edges.map((edge: any) => {
        const globalId = edge.node.id; // Format: gid://shopify/Product/123456789
        return globalId.split('/').pop(); // Get just the numeric ID
      });

      return productIds;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to fetch products: ${error.message}`);
      }
      throw new Error('Failed to fetch products from store');
    }
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const baseUrl = this.baseUrl.replace('/products.json', '');
      const url = `${baseUrl}/products/${productId}.json`;
      
      const response = await axios.get(url, {
        headers: this.getHeaders()
      });
      return response.data.product;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 404) {
          return null;
        }
        throw new Error(`Failed to fetch product: ${error.message}`);
      }
      throw new Error('Failed to fetch product from store');
    }
  }

  private async getPublicationIds(): Promise<Map<string, string>> {
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

    return publicationMap;
  }

  async updateProductSalesChannels(productId: string, salesChannels: string[]): Promise<Product> {
    try {
      // First, get all publication IDs and their names
      const publicationMap = await this.getPublicationIds();
      
      // Format the product ID for GraphQL
      const gqlProductId = `gid://shopify/Product/${productId}`;
      
      // For each sales channel, we need to publish/unpublish the product
      for (const [channelName, publicationId] of publicationMap.entries()) {
        const shouldPublish = salesChannels.includes(channelName);
        
        const mutation = shouldPublish ? `
          mutation {
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
          }
        ` : `
          mutation {
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
          }
        `;

        const response = await axios.post(
          this.graphqlUrl,
          { query: mutation },
          { headers: this.getHeaders() }
        );

        if (response.data.errors) {
          throw new Error(response.data.errors[0].message);
        }

        const result = response.data.data;
        if (result.userErrors?.length > 0) {
          throw new Error(`Failed to update publication status: ${result.userErrors[0].message}`);
        }
      }

      // Return the updated product
      return this.getProduct(productId) as Promise<Product>;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to update product sales channels: ${error.message}`);
      }
      throw new Error('Failed to update product sales channels');
    }
  }
} 