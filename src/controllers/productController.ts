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
      res.status(500).json({
        success: false,
        message: 'Error updating product sales channels'
      });
    }
  }

  async getProduct(req: Request, res: Response) {
    try {
      const productId = req.params.id;
      const product = await productService.getProduct(productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      res.json(product);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching product'
      });
    }
  }

  async getAllProducts(req: Request, res: Response) {
    try {
      const products = await productService.getAllProducts();
      res.json(products);
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching products'
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