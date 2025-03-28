# Product Sales Channel Bulk Update API

A Node.js backend API for managing product sales channels with bulk update capabilities. This API acts as a proxy to your store's API, providing bulk update functionality for product sales channels.

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Update the `.env` file with your store API configuration:
```
PORT=3000
STORE_API_URL=https://your-store-api.com
STORE_API_KEY=your-store-api-key-here
```

4. Start the development server:
```bash
yarn dev
```

5. Build for production:
```bash
yarn build
```

6. Start production server:
```bash
yarn start
```

## API Endpoints

### Get All Products
- **GET** `/api/products`
- Fetches all products from the store API

### Get Single Product
- **GET** `/api/products/:id`
- Fetches a single product from the store API

### Bulk Update Sales Channels
- **POST** `/api/products/bulk-update-sales-channels`
- Updates sales channels for multiple products in the store
- Request body:
```json
{
  "productIds": ["product1", "product2", "product3"],
  "salesChannels": ["online", "retail", "wholesale"]
}
```

## Response Format

All responses follow this format:
```json
{
  "success": true,
  "message": "Operation message",
  "data": {} // Optional data field
}
```

## Error Handling

The API returns appropriate HTTP status codes:
- 200: Success
- 201: Created
- 400: Bad Request
- 404: Not Found
- 500: Internal Server Error

## Store API Integration

This API acts as a proxy to your store's API, providing the following features:
- Fetches products directly from the store
- Updates product sales channels in the store
- Handles bulk operations efficiently
- Provides error handling and retry logic

Make sure to configure the following environment variables:
- `STORE_API_URL`: The base URL of your store's API
- `STORE_API_KEY`: The authentication key for your store's API 