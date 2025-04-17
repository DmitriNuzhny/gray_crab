import './config/env'; // Import environment config first
import express from 'express';
import cors from 'cors';
import productRoutes from './routes/productRoutes';
import syncRoutes from './routes/syncRoutes';
import webhookRoutes from './routes/webhookRoutes';
import { env } from './config/env';
import { SchedulerService } from './services/schedulerService';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase the limit to 50MB
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Also increase URL-encoded limit

// Routes
app.use('/api/products', productRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/webhooks', webhookRoutes);

// Initialize scheduler service - only in non-serverless environments
// This prevents the scheduler from running in Vercel's serverless functions
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  const schedulerService = new SchedulerService();
  schedulerService.startNewProductsScheduler();
}

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: err.message
  });
});

// Only start the server if we're not in a serverless environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });
}

export default app; 