import { Request, Response } from 'express';
import { ProductSync } from '../syncProducts';

export const syncProducts = async (req: Request, res: Response) => {
  try {
    const sync = new ProductSync();
    
    // Start the sync process
    await sync.syncAllProducts();
    
    res.status(200).json({
      success: true,
      message: 'Product synchronization started successfully'
    });
  } catch (error) {
    console.error('Error in sync controller:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to start product synchronization',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}; 