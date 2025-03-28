import { Product, BulkUpdateRequest, UpdateResponse } from '../types/product';
import { StoreService } from './storeService';

export class ProductService {
  private storeService: StoreService;

  constructor() {
    this.storeService = new StoreService();
  }

  async bulkUpdateSalesChannels(request: BulkUpdateRequest): Promise<UpdateResponse> {
    const { productIds, salesChannels } = request;
    const updatedProducts: string[] = [];
    const failedProducts: string[] = [];

    for (const productId of productIds) {
      try {
        await this.storeService.updateProductSalesChannels(productId, salesChannels);
        updatedProducts.push(productId);
      } catch (error) {
        failedProducts.push(productId);
      }
    }

    return {
      success: failedProducts.length === 0,
      message: failedProducts.length === 0 
        ? 'All products updated successfully' 
        : `Updated ${updatedProducts.length} products, ${failedProducts.length} products failed`,
      updatedProducts,
      failedProducts
    };
  }

  async getProduct(productId: string): Promise<Product | null> {
    return this.storeService.getProduct(productId);
  }

  async getAllProducts(): Promise<Product[]> {
    return this.storeService.getAllProducts();
  }

  async createProduct(product: Omit<Product, 'id'>): Promise<Product> {
    // Note: This method is not implemented as it should be handled by the store API
    throw new Error('Create product operation should be handled by the store API');
  }
} 