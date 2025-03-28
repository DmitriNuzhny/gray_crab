import './config/env'; // Import environment config first
import express from 'express';
import cors from 'cors';
import productRoutes from './routes/productRoutes';
import { env } from './config/env';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase the limit to 50MB
app.use(express.urlencoded({ limit: '50mb', extended: true })); // Also increase URL-encoded limit

// Routes
app.use('/api/products', productRoutes);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: err.message
  });
});

app.listen(env.port, () => {
  console.log(`Server is running on port ${env.port}`);
});

export default app; 