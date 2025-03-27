# Product Sales Channel Bulk Update API

A Node.js backend API for managing product sales channels with bulk update capabilities.

## Setup

1. Install dependencies:
```bash
yarn install
```

2. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

3. Update the `.env` file with your secure API key:
```
PORT=3000
ADMIN_API_KEY=your-secure-api-key-here
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

### Public Endpoints

#### Get All Products
- **GET** `/api/products`

#### Get Single Product
- **GET** `/api/products/:id`

### Protected Admin Endpoints

These endpoints require an API key to be included in the request header:
```
X-API-Key: your-api-key-here
```

#### Create Product
- **POST** `/api/products`
- Request body:
```json
{
  "name": "Product Name",
  "price": 99.99,
  "salesChannels": ["online", "retail"],
  "description": "Product description"
}
```

#### Bulk Update Sales Channels
- **POST** `/api/products/bulk-update-sales-channels`
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
- 401: Unauthorized (Invalid or missing API key)
- 404: Not Found
- 500: Internal Server Error

## Security

- Admin operations require a valid API key
- API key should be kept secure and never shared
- Use HTTPS in production
- Consider implementing rate limiting for production use 