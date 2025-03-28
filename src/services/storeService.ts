import axios from 'axios';
import { Product } from '../types/product';

export class StoreService {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = process.env.STORE_API_URL || '';
    this.apiKey = process.env.STORE_API_KEY || '';
    
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

  async getAllProducts(): Promise<Product[]> {
    try {
      const response = await axios.get(this.baseUrl, {
        headers: this.getHeaders()
      });
      return response.data.products;
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

  async updateProductSalesChannels(productId: string, salesChannels: string[]): Promise<Product> {
    try {
      const baseUrl = this.baseUrl.replace('/products.json', '');
      const url = `${baseUrl}/products/${productId}.json`;
      
      const response = await axios.put(
        url,
        {
          product: {
            id: productId,
            salesChannels: salesChannels
          }
        },
        { headers: this.getHeaders() }
      );
      return response.data.product;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`Failed to update product: ${error.message}`);
      }
      throw new Error('Failed to update product sales channels');
    }
  }
} 