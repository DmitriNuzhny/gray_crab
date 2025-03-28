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
    
    console.log('StoreService initialized with URL:', this.baseUrl);
    console.log('API Key length:', this.apiKey.length);
  }

  private getHeaders() {
    return {
      'X-Shopify-Access-Token': this.apiKey,
      'Content-Type': 'application/json'
    };
  }

  async getAllProducts(): Promise<Product[]> {
    try {
      console.log('Fetching all products from:', this.baseUrl);
      const response = await axios.get(this.baseUrl, {
        headers: this.getHeaders()
      });
      console.log('Response received:', response.status);
      console.log('Response headers:', response.headers);
      console.log('Number of products:', response.data.products?.length || 0);
      return response.data.products;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          config: {
            url: error.config?.url,
            method: error.config?.method,
            headers: error.config?.headers
          }
        });
      }
      throw new Error('Failed to fetch products from store');
    }
  }

  async getProduct(productId: string): Promise<Product | null> {
    try {
      const baseUrl = this.baseUrl.replace('/products.json', '');
      const url = `${baseUrl}/products/${productId}.json`;
      console.log('Fetching product from:', url);
      
      const response = await axios.get(url, {
        headers: this.getHeaders()
      });
      console.log('Response received:', response.status);
      console.log('Product data:', response.data);
      return response.data.product;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          config: {
            url: error.config?.url,
            method: error.config?.method,
            headers: error.config?.headers
          }
        });
        if (error.response?.status === 404) {
          return null;
        }
      }
      throw new Error('Failed to fetch product from store');
    }
  }

  async updateProductSalesChannels(productId: string, salesChannels: string[]): Promise<Product> {
    try {
      const baseUrl = this.baseUrl.replace('/products.json', '');
      const url = `${baseUrl}/products/${productId}.json`;
      console.log('Updating product at:', url);
      
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
      console.log('Response received:', response.status);
      console.log('Updated product data:', response.data);
      return response.data.product;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          message: error.message,
          config: {
            url: error.config?.url,
            method: error.config?.method,
            headers: error.config?.headers
          }
        });
      }
      throw new Error('Failed to update product sales channels');
    }
  }
} 