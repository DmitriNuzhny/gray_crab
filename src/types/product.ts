export interface Product {
  id: string;
  name: string;
  salesChannels: string[];
  price: number;
  description?: string;
}

export interface BulkUpdateRequest {
  productIds: string[];
  salesChannels: string[];
}

export interface UpdateResponse {
  success: boolean;
  message: string;
  updatedProducts?: string[];
  failedProducts?: string[];
} 