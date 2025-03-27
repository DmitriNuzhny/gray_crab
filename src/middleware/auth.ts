import { Request, Response, NextFunction } from 'express';

export const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-api-key'];
  const adminApiKey = process.env.ADMIN_API_KEY;

  if (!apiKey || apiKey !== adminApiKey) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or missing API key'
    });
  }

  next();
}; 