
// The standardized row structure for the SKU Generator
export interface CleanerRow {
  _internal_id?: number | string; // React Key
  checkStatus?: 'unverified' | 'verified'; // Track if row has been checked by AI
  // Dynamic fields for SKU data
  '商品名称'?: string;
  '商品价格'?: string;
  '商品拼单价'?: string;
  'SKU规格'?: string;
  'SKU价格'?: string;
  'SKU库存'?: string;
  'SKU商家编码'?: string;
  '商品主图'?: string;
  '商品详情'?: string;
  '商品类目'?: string;
  [key: string]: any; 
}

// Updated extracted entity for products
export interface ParsedProduct {
  productName: string;
  price: string;
  specs: string;     // e.g. "颜色:红;尺码:L"
  skuCode: string;   // Merchant/SKU Code
  stock: string;
  description: string; // Plain text description or Selling points
  detailHtml: string;  // HTML content for "商品详情"
  images: string;      // Comma separated URLs
  skuImage?: string;   // Variant specific image (e.g. Color image)
  category: string;    // Predicted category
}

export interface AIResponse {
  raw: string;
  parsed: ParsedProduct[];
}

export type SheetRow = CleanerRow;