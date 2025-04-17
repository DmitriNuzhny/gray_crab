export interface Product {
  id: string;
  name?: string;
  salesChannels?: string[];
  price?: number;
  description?: string;
  title?: string;
  tags?: string[] | string;
  product_type?: string;
  variants?: ProductVariant[];
  [key: string]: any; // For any other Shopify fields that might be returned
}

export interface ProductVariant {
  id: string;
  title?: string;
  sku?: string;
  price?: number;
  option1?: string;
  option2?: string;
  option3?: string;
  [key: string]: any; // For any other variant fields
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
  google_product_category: string;
  color: string;
  size: string;
  gender: string;
  age_group: string;
}

export interface GoogleAttributesBulkUpdateRequest {
  productIds: string[];
  attributes: GoogleProductAttributes;
} 