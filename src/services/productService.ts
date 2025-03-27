import { Product, BulkUpdateRequest, UpdateResponse } from '../types/product';

// In-memory storage for products (replace with actual database in production)
let products: Product[] = [];

export class ProductService {
  async bulkUpdateSalesChannels(request: BulkUpdateRequest): Promise<UpdateResponse> {
    const { productIds, salesChannels } = request;
    const updatedProducts: string[] = [];
    const failedProducts: string[] = [];

    for (const productId of productIds) {
      const productIndex = products.findIndex(p => p.id === productId);
      
      if (productIndex !== -1) {
        products[productIndex] = {
          ...products[productIndex],
          salesChannels: [...new Set([...products[productIndex].salesChannels, ...salesChannels])]
        };
        updatedProducts.push(productId);
      } else {
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
    return products.find(p => p.id === productId) || null;
  }

  async getAllProducts(): Promise<Product[]> {
    return products;
  }

  async createProduct(product: Omit<Product, 'id'>): Promise<Product> {
    const newProduct: Product = {
      ...product,
      id: Math.random().toString(36).substr(2, 9)
    };
    products.push(newProduct);
    return newProduct;
  }
} 