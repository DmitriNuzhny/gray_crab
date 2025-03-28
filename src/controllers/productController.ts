import { Request, Response } from 'express';
import { ProductService } from '../services/productService';
import { StoreService } from '../services/storeService';

export class ProductController {
  private storeService: StoreService;
  private productService: ProductService;

  constructor() {
    this.storeService = new StoreService();
    this.productService = new ProductService(this.storeService);
  }

  getAllSalesChannels = async (req: Request, res: Response) => {
    try {
      const salesChannels = await this.storeService.getAllSalesChannels();
      res.json({
        success: true,
        message: 'Sales channels fetched successfully',
        data: salesChannels
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching sales channels',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  bulkUpdateSalesChannels = async (req: Request, res: Response) => {
    try {
      const { salesChannels } = req.body;

      if (!Array.isArray(salesChannels)) {
        return res.status(400).json({ 
          success: false, 
          message: 'salesChannels must be an array' 
        });
      }

      const result = await this.storeService.bulkUpdateSalesChannels(salesChannels);
      res.json(result);
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to bulk update sales channels',
        updatedProducts: [],
        failedProducts: []
      });
    }
  };

  getProduct = async (req: Request, res: Response) => {
    try {
      const productId = req.params.id;
      const product = await this.productService.getProduct(productId);
      
      if (!product) {
        return res.status(404).json({
          success: false,
          message: 'Product not found'
        });
      }

      res.json({
        success: true,
        message: 'Product fetched successfully',
        data: product
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  getAllProducts = async (req: Request, res: Response) => {
    try {
      const products = await this.productService.getAllProducts();
      res.json({
        success: true,
        message: 'Products fetched successfully',
        data: products
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error fetching products',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  createProduct = async (req: Request, res: Response) => {
    try {
      const product = await this.productService.createProduct(req.body);
      res.status(201).json({
        success: true,
        message: 'Product created successfully',
        data: product
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Error creating product',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  updateProductSalesChannels = async (req: Request, res: Response) => {
    try {
      const { id } = req.params;
      const { salesChannels } = req.body;

      if (!Array.isArray(salesChannels)) {
        return res.status(400).json({ 
          success: false, 
          message: 'salesChannels must be an array' 
        });
      }

      const updatedProduct = await this.storeService.updateProductSalesChannels(id, salesChannels);
      res.json({ 
        success: true, 
        message: 'Product sales channels updated successfully',
        data: updatedProduct 
      });
    } catch (error) {
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to update product sales channels' 
      });
    }
  };
} 