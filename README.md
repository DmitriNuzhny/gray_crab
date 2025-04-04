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

### Product Endpoints

#### Get All Products
- **GET** `/api/products`
- Fetches all products from the store API

#### Get Single Product
- **GET** `/api/products/:id`
- Fetches a single product by ID from the store API

#### Get All Sales Channels
- **GET** `/api/products/sales-channels`
- Retrieves all available sales channels from the store

#### Update Product Sales Channels
- **POST** `/api/products/:id/sales-channels`
- Updates the sales channels for a specific product
- Request body:
```json
{
  "salesChannels": ["Online Store", "POS", "Faire: Sell Wholesale"]
}
```

### Bulk Operations

#### Bulk Update Sales Channels
- **POST** `/api/products/bulk-update-sales-channels`
- Starts a bulk operation to update sales channels for all products
- Request body:
```json
{
  "salesChannels": ["Online Store", "POS", "Faire: Sell Wholesale"]
}
```
- Returns an operation ID to check status and process results

#### Check Bulk Operation Status
- **GET** `/api/products/bulk-operations/:operationId`
- Checks the status of a bulk operation by ID
- Returns status information including completion status and result URL

#### Process Bulk Operation for Sales Channels
- **POST** `/api/products/process-bulk-operation-sales-channels`
- Processes the results of a completed bulk operation to update sales channels
- Request body:
```json
{
  "operationId": "gid://shopify/BulkOperation/123456",
  "salesChannels": ["Online Store", "POS", "Faire: Sell Wholesale"]
}
```

#### Bulk Update Sales Channels by IDs
- **POST** `/api/products/bulk-update-sales-channels-by-ids`
- Updates sales channels for specific product IDs
- Request body:
```json
{
  "productIds": ["123", "456", "789"],
  "salesChannels": ["Online Store", "POS", "Faire: Sell Wholesale"]
}
```

### Product Analysis Endpoints

#### Get Products Missing Channels
- **GET** `/api/products/products-missing-channels`
- Returns IDs of all products that are missing one or more sales channels

#### Get Products With Google/YouTube Missing Attributes
- **GET** `/api/products/products-with-google-youtube-missing-attributes`
- Returns IDs of products published to Google/YouTube but missing required attributes

#### Get Products With Faire Channel
- **GET** `/api/products/products-with-faire-channel`
- Returns IDs of all products published to the "Faire: Sell Wholesale" sales channel

### Google Attributes Endpoints

#### Bulk Update Google Attributes
- **POST** `/api/products/bulk-update-google-attributes`
- Updates Google attributes for multiple products
- Request body:
```json
{
  "productIds": ["123", "456", "789"],
  "attributes": {
    "category": "Apparel & Accessories > Clothing",
    "gender": "female",
    "ageGroup": "adult",
    "color": "black",
    "size": "M"
  }
}
```

#### Auto Update Google Attributes
- **POST** `/api/products/auto-update-google-attributes`
- Automatically updates Google attributes for products based on existing product data
- Request body:
```json
{
  "productIds": ["123", "456", "789"]
}
```

#### Apply Google Attributes
- **POST** `/api/products/apply-google-attributes`
- Applies specific Google attributes to products
- Request body:
```json
{
  "productIds": ["123", "456", "789"],
  "attributeKey": "category",
  "attributeValue": "Apparel & Accessories > Clothing"
}
```

### Sync Endpoints

#### Sync Products
- **POST** `/api/sync/sync`
- Synchronizes products between your store and external platforms like TikTok
- Request body:
```json
{
  "accessToken": "your-access-token"
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
- Rate-limiting to prevent API throttling

Make sure to configure the following environment variables:
- `STORE_API_URL`: The base URL of your store's API
- `STORE_API_KEY`: The authentication key for your store's API 