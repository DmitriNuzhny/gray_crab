import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface ShopifyProduct {
  id: number;
  title: string;
  description: string;
  variants: Array<{
    id: number;
    price: string;
    sku: string;
    inventory_quantity: number;
  }>;
  images: Array<{
    src: string;
  }>;
}

interface TikTokProduct {
  product_name: string;
  description: string;
  category_id: string;
  brand_id: string;
  price: {
    original_price: number;
    currency: string;
  };
  stock_info: {
    available_stock: number;
  };
  sku_list: Array<{
    original_price: number;
    seller_sku: string;
    available_stock: number;
  }>;
  package_dimensions: {
    height: number;
    length: number;
    width: number;
    weight: number;
  };
  package_weight: {
    value: number;
    unit: string;
  };
  shipping_info: {
    shipping_provider: string;
  };
  images: {
    main: {
      image_id: string;
    };
    additional: Array<{
      image_id: string;
    }>;
  };
  product_status: string;
  product_certifications: Array<{
    id: string;
    files: string[];
  }>;
}

export class ProductSync {
  private shopifyAccessToken: string;
  private shopifyStore: string;
  private tiktokAccessToken: string;

  constructor() {
    this.shopifyAccessToken = process.env.STORE_API_KEY || '';
    this.shopifyStore = process.env.SHOPIFY_STORE || '';
    this.tiktokAccessToken = process.env.TIKTOK_ACCESS_TOKEN || '';

    if (!this.shopifyAccessToken || !this.shopifyStore || !this.tiktokAccessToken) {
      throw new Error('Missing required environment variables');
    }
  }

  private async getShopifyProducts(limit: number = 250, sinceId: number = 0): Promise<{ products: ShopifyProduct[], lastId: number }> {
    try {
      const response = await axios.get(
        `https://${this.shopifyStore}/admin/api/2024-04/products.json`,
        {
          params: {
            limit,
            since_id: sinceId,
          },
          headers: {
            'X-Shopify-Access-Token': this.shopifyAccessToken,
            'Content-Type': 'application/json',
          },
        }
      );
      const products = response.data.products;
      const lastId = products.length > 0 ? products[products.length - 1].id : 0;
      return { products, lastId };
    } catch (error) {
      console.error('Error fetching Shopify products:', error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
      }
      throw error;
    }
  }

  private async uploadImageToTikTok(imageUrl: string): Promise<string> {
    try {
      // First, we need to get a pre-signed URL to upload the image
      const uploadUrlResponse = await axios.post(
        'https://business-api.tiktok.com/open_api/v1.2/image/upload/',
        {},
        {
          headers: {
            'Authorization': `Bearer ${this.tiktokAccessToken}`,
            'Content-Type': 'application/json'
          },
        }
      );

      // Download the image from Shopify
      const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      const imageBuffer = Buffer.from(imageResponse.data, 'binary');

      // Upload the image to the TikTok pre-signed URL
      await axios.put(uploadUrlResponse.data.data.upload_url, imageBuffer, {
        headers: {
          'Content-Type': 'image/jpeg'
        }
      });

      // Return the image ID
      return uploadUrlResponse.data.data.image_id;
    } catch (error) {
      console.error('Error uploading image to TikTok:', error);
      throw error;
    }
  }

  private async getCategoryId(): Promise<string> {
    try {
      const response = await axios.get(
        'https://business-api.tiktok.com/open_api/v1.2/catalog/categories/',
        {
          headers: {
            'Authorization': `Bearer ${this.tiktokAccessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Return the first active category ID or a default one
      const categories = response.data.data.categories;
      if (categories && categories.length > 0) {
        return categories[0].id;
      }
      
      // If no categories are available, use a default one (may need to be adjusted)
      return '508900'; // Default category ID for "Other"
    } catch (error) {
      console.error('Error fetching TikTok categories:', error);
      return '508900'; // Default fallback
    }
  }

  private async syncToTikTok(product: ShopifyProduct): Promise<void> {
    try {
      // Get TikTok category ID
      const categoryId = await this.getCategoryId();
      
      // Upload images to TikTok
      let mainImageId = '';
      const additionalImageIds = [];
      
      if (product.images && product.images.length > 0) {
        mainImageId = await this.uploadImageToTikTok(product.images[0].src);
        
        // Upload additional images (skip the first one)
        for (let i = 1; i < Math.min(product.images.length, 9); i++) {
          const imageId = await this.uploadImageToTikTok(product.images[i].src);
          additionalImageIds.push({ image_id: imageId });
        }
      }

      const tiktokProduct: TikTokProduct = {
        product_name: product.title.substring(0, 100), // TikTok limits product names to 100 chars
        description: product.description || 'No description provided',
        category_id: categoryId,
        brand_id: '', // Optional, can be left empty
        price: {
          original_price: parseFloat(product.variants[0].price),
          currency: 'USD'
        },
        stock_info: {
          available_stock: product.variants[0].inventory_quantity
        },
        sku_list: product.variants.map(variant => ({
          original_price: parseFloat(variant.price),
          seller_sku: variant.sku,
          available_stock: variant.inventory_quantity
        })),
        package_dimensions: {
          height: 10, // Default values in cm
          length: 10,
          width: 10,
          weight: 0.5
        },
        package_weight: {
          value: 0.5, // Default value in kg
          unit: 'kg'
        },
        shipping_info: {
          shipping_provider: 'Standard'
        },
        images: {
          main: {
            image_id: mainImageId
          },
          additional: additionalImageIds
        },
        product_status: 'ACTIVE',
        product_certifications: []
      };

      // Send the product to TikTok
      const response = await axios.post(
        'https://business-api.tiktok.com/open_api/v1.2/products/create/',
        tiktokProduct,
        {
          headers: {
            'Authorization': `Bearer ${this.tiktokAccessToken}`,
            'Content-Type': 'application/json'
          },
        }
      );

      console.log(`Product ${product.title} successfully synced to TikTok`);
    } catch (error) {
      console.error(`Error syncing product ${product.id} to TikTok:`, error);
      if (axios.isAxiosError(error)) {
        console.error('Response data:', error.response?.data);
      }
      throw error;
    }
  }

  public async syncAllProducts(): Promise<void> {
    const limit = 250;
    let sinceId = 0;
    let hasMoreProducts = true;

    while (hasMoreProducts) {
      try {
        const { products, lastId } = await this.getShopifyProducts(limit, sinceId);
        
        if (products.length === 0) {
          hasMoreProducts = false;
          break;
        }

        console.log(`Syncing products from since_id ${sinceId}...`, products.length);
        
        for (const product of products) {
          await this.syncToTikTok(product);
          console.log(`Synced product: ${product.title}`);
        }

        sinceId = lastId;
      } catch (error) {
        console.error('Error during sync:', error);
        break;
      }
    }
  }
} 