import { Request, Response } from 'express';
import { ProductService } from '../services/productService';
import { BulkUpdateRequest, Product } from '../types/product';

const productService = new ProductService();

export class ProductController {
  async bulkUpdateSalesChannels(req: Request, res: Response) {
    try {
      const request: BulkUpdateRequest = req.body;
      
      if (!request.productIds || !request.salesChannels) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: productIds and salesChannels'
        });
      }

      const result = await productService.bulkUpdateSalesChannels(request);
      res.json(result);
    } catch (error) {
      console.error('Error in bulkUpdateSalesChannels:', error);
      res.status(500).json({
        success: false,
        message: 'Error updating product sales channels'
      });
    }
  }

  async getProduct(req: Request, res: Response) {
    try {
      const productId = req.params.id;
      console.log('Fetching product with ID:', productId);
      
      const product = await productService.getProduct(productId);
      
      if (!product) {
        console.log('Product not found:', productId);
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      console.log('Product found:', product);
      res.json({
        success: true,
        message: 'Product fetched successfully',
        data: product
      });
    } catch (error) {
      console.error('Error in getProduct:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async getAllProducts(req: Request, res: Response) {
    try {
      console.log('Fetching all products');
      const products = await productService.getAllProducts();
      console.log(`Found ${products.length} products`);
      
      res.json({
        success: true,
        message: 'Products fetched successfully',
        data: products
      });
    } catch (error) {
      console.error('Error in getAllProducts:', error);
      res.status(500).json({
        success: false,
        message: 'Error fetching products',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  async createProduct(req: Request, res: Response) {
    try {
      const product = await productService.createProduct(req.body);
      res.status(201).json(product);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error creating product'
      });
    }
  }
} 