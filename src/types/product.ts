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

export interface GoogleProductAttributes {
  category?: string;
  color?: string;
  size?: string;
  gender?: string;
  ageGroup?: string;
}

export interface GoogleAttributesBulkUpdateRequest {
  productIds: string[];
  attributes: GoogleProductAttributes;
} 