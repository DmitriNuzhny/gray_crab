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
} 