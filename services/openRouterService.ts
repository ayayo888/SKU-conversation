import { ParsedProduct } from "../types";

// Using the model requested by user
const MODEL_NAME = "google/gemini-3-flash-preview";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

console.log(`[System] OpenRouter Service Loaded - Model: ${MODEL_NAME}`);

// Custom Error class
export class ApiError extends Error {
  rawResponse?: string;
  constructor(message: string, rawResponse?: string) {
    super(message);
    this.name = 'ApiError';
    this.rawResponse = rawResponse;
  }
}

// 1. Strict Schema for Extraction - Aligned with "模板说明.md"
const EXTRACT_JSON_SCHEMA = {
  name: "sku_extraction_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      products: {
        type: "array",
        description: "List of SKU objects. One object per SKU variant.",
        items: {
          type: "object",
          properties: {
            productName: { 
              type: "string", 
              description: "商品名称 (所有SKU保持一致)" 
            },
            price: { 
              type: "string", 
              description: "价格 (纯数字，去除货币符号)" 
            },
            specs: { 
              type: "string", 
              description: "SKU规格，格式严格为 '属性名:属性值;属性名:属性值' (例如: '颜色:白色;尺码:M')" 
            },
            skuCode: { 
              type: "string", 
              description: "商家编码/货号 (仅提取数字或字母，严禁包含中文。若原文未提及，请返回空字符串)" 
            },
            stock: { 
              type: "string", 
              description: "库存数量 (若无法确定具体SKU库存，使用默认值)" 
            },
            description: { 
              type: "string", 
              description: "商品简要卖点" 
            },
            detailHtml: {
              type: "string",
              description: "商品详情区域的 HTML 源码片段 (保留 div/img/table 标签)"
            },
            images: {
              type: "string",
              description: "主图链接，多个链接用英文逗号分隔。**严禁包含 cnfans 域名的链接**，必须提取原始图片地址。"
            },
            skuImage: {
              type: "string",
              description: "该SKU对应的特定规格图片链接 (例如：选中‘颜色:红’时显示的红色商品图)。**严禁 cnfans 链接**。若找不到特定图，请返回空字符串。"
            },
            category: {
              type: "string",
              description: "推测的商品类目 (例如: 女装>>半身裙)"
            }
          },
          required: ["productName", "price", "specs", "skuCode", "stock", "description", "detailHtml", "images", "skuImage", "category"],
          additionalProperties: false
        }
      }
    },
    required: ["products"],
    additionalProperties: false
  }
};

// 2. Strict Schema for Renaming
const RENAME_JSON_SCHEMA = {
  name: "rename_products_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      renamed_list: {
        type: "array",
        description: "List of renamed products",
        items: {
            type: "object",
            properties: {
                original: { type: "string", description: "The original name input" },
                new_name: { type: "string", description: "The new processed English name" }
            },
            required: ["original", "new_name"],
            additionalProperties: false
        }
      }
    },
    required: ["renamed_list"],
    additionalProperties: false
  }
};

// 3. Strict Schema for SKU Optimization
const SKU_OPTIMIZE_JSON_SCHEMA = {
  name: "sku_optimization_response",
  strict: true,
  schema: {
    type: "object",
    properties: {
      optimized_list: {
        type: "array",
        description: "List of optimized SKU specs",
        items: {
            type: "object",
            properties: {
                original: { type: "string", description: "The original SKU spec string" },
                optimized: { type: "string", description: "The translated English SKU spec string" }
            },
            required: ["original", "optimized"],
            additionalProperties: false
        }
      }
    },
    required: ["optimized_list"],
    additionalProperties: false
  }
};

// --- PROMPTS ---

const SYSTEM_PROMPT_EXTRACT = `
# Role
你是一个高精度的电商 HTML 解析引擎 (E-commerce DOM Parser)。你的核心能力是能够像浏览器遍历 DOM 树一样，毫无遗漏地提取所有列表项，绝不因为 DOM 结构微小的变化而中断。

# Goal
分析用户提供的 HTML 片段，提取商品主信息及所有 SKU 变体，输出符合 Schema 的 JSON。

# Critical Rule
1. Exhaustive Iteration (穷尽遍历): 你必须提取 .attr-list-wrapper 下的每一个 .attr-list-item 节点。如果 HTML 中有 12 个 item，你必须输出 12 个 SKU。严禁因为某些 item 缺少图片或文本简短而跳过。
2. Missing Attribute Handling (缺失属性处理): 某些 SKU (如定制选项或特殊版本) 可能没有 img 标签。在这种情况下，skuImage 字段必须设为空字符串 ""，绝对不能丢弃该 SKU。
3. Strict JSON Syntax: 输出必须是合法的 JSON，不要包含 Markdown 代码块标记以外的多余文本。

# Step-by-Step Thinking
在生成最终 JSON 之前，请在内心执行以下逻辑：
1. 定位容器: 找到 class="attr-list-wrapper" 的元素。
2. 计数节点: 数一下该容器下直接包含的 .attr-list-item 数量是 N 个。
3. 逐个解析: 从第 1 个到第 N 个，循环提取数据。
   - 如果发现 .attr-item-image，提取 src。
   - 如果没有发现 image 标签，src = ""。
   - 提取 .attr-item-value 或 .n-ellipsis 中的文本。

# Extraction Logic (DOM Selectors)

## 1. Global Info
- Title: .product-title-info 的文本。
- Price: .product-price-cny 的文本 (提取数字部分)。
- Images: .product-thumb-image 的 src 列表。
  - Rule: 必须过滤掉 cnfans.com 域名，保留原始 alicdn/taobao 链接。去除 _50x50 等缩略图后缀。
- DetailHtml: .content-container 的 innerHTML。

## 2. SKU Parsing (关键)
- Root: .sku-container -> .attr-list-wrapper
- Item: .attr-list-item (遍历每一个)
  - Specs (Name): 提取内部 .attr-item-value -> .n-ellipsis 的文本。
    - Format: 属性名:属性值; (若无法区分属性名，默认用 "规格:")。
    - Example: "规格:标准钢33英寸;"
  - SkuImage: 提取内部 img.attr-item-image 的 src。
    - Fallback: 若无 img 标签，返回 "" (空字符串)。
  - Price: 继承主商品价格 (除非 SKU 内部有特定价格标签)。
  - Stock: 默认 999。

# Output Schema
{
  "title": "String",
  "price": "Number",
  "images": "String (comma separated URLs)",
  "detailHtml": "String",
  "skus": [
    {
      "skuName": "String (原始文本)",
      "skuImage": "String (URL or empty)",
      "price": "Number",
      "stock": "Number",
      "specs": "String (Formatted)",
      "skuCode": "String (Empty if not found)"
    }
  ]
}

# Input HTML
[在此处插入 HTML]
`;

export const SYSTEM_PROMPT_RENAME = `
你是一个非常了解高尔夫产品的美国人，英语是你的母语，也是一个电商英文标题翻译专家。
任务：将提供的【商品名称】修改为【纯英文】名称。

规则：
1. 翻译成地道的，简短的，购买高尔夫产品的人群一眼就能明白的英文。
2. **严禁出现任何品牌词** (如 Silver，Nike, Adidas, 茵曼, Uniqlo, etc.)，如果有型号词一定要保留。
3. 不需要把中文标题完整的翻译过来，只需要简短的描述产品的类型、颜色等关键词。
4. 将中文或中英混合的标题，彻底转换为纯英文。
5. 要符合高尔夫产品使用者的常见英文说法
6. 当标题里面出现中文：小鸡腿，这种说法的时候请替换成Hybrid
7.当出现标准款或者普通款这种中文时请使用Standard
8.不要在商标里面出现Headcover这个单词
9. 当标题里面出现中文：一号木，这种说法的时候请替换成Driver
10.当标题里面出现中文：球道木，这种说法的时候请替换成FW
11.当出现男士、男式这些中文时，用Men's，出现女士，女式时是用Ladies
`;

export const SYSTEM_PROMPT_SKU_OPTIMIZE = `
你是一个非常了解高尔夫产品的美国人，英语是你的母语，也是一个电商英文标题翻译专家。
任务：将提供的【SKU规格】字符串从翻译为【英文】。

规则：
1. **严格保留格式**：必须保持 "属性名:属性值;属性名:属性值" 的结构。严禁修改冒号(:)和分号(;)。
2. 翻译准确：
   - 颜色 -> Color, 尺码 -> Size
   - 红色 -> Red, 黑色 -> Black, XL码 -> XL, 等等。
   - S -> Stiff, SR -> SR ，R -> Regular,当出现关于硬度的英文描述，请按照这个规则转换 

3. 如果原文已经是英文，请原样返回，不要修改。
4. 保持简洁，首字母大写。
5.要符合高尔夫行业的常见英文说法
6.出现女士、男士、女式、男式这样的说法，要改成Ladies或者Men's
7.当出现中文：球道木，这种说法的时候请替换成FW

示例：
输入: "颜色:黑色;尺码:L"
输出: "Color:Black;Size:L"
`;

// --- Helper: Robust JSON Parsing ---
const safeJsonParse = (rawText: string, context: string) => {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.warn(`[${context}] Direct JSON parse failed, trying to strip Markdown...`);
    let cleanText = rawText
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim();
    
    const firstBrace = cleanText.indexOf('{');
    const lastBrace = cleanText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleanText = cleanText.substring(firstBrace, lastBrace + 1);
    }
      
    try {
      return JSON.parse(cleanText);
    } catch (e2) {
      console.error(`[${context}] Final JSON parse failed.`, e2);
      throw new ApiError(`JSON Parse Failed: ${(e2 as Error).message}`, rawText);
    }
  }
};

// --- Helper: Data Normalization (Fixes symbol/rendering issues) ---
const normalizeProductData = (products: ParsedProduct[]): ParsedProduct[] => {
  return products.map(p => {
    // 1. Normalize Specs: "Key：Value" -> "Key:Value", fix delimiters
    let specs = p.specs || "";
    specs = specs
      .replace(/：/g, ":") // Chinese colon to English
      .replace(/[；，,]/g, ";") // Common delimiters to semicolon
      .replace(/\n/g, ";") // Newlines to semicolon
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .join(";"); // Rejoin with strict semicolon

    // 2. Normalize Images: "url1\nurl2" -> "url1,url2"
    let images = p.images || "";
    images = images
      .replace(/[，\n\s]+/g, ",") // Delimiters/spaces to comma
      .split(",")
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .join(",");

    // 3. Normalize SKU Image (Usually single, but handle cleanup)
    let skuImage = p.skuImage || "";
    skuImage = skuImage.replace(/[\n\s]+/g, "").trim();
    // Safety check for cnfans (redundant if prompt works, but good for robustness)
    if (skuImage.includes("cnfans.com")) skuImage = "";

    return {
      ...p,
      specs,
      images,
      skuImage
    };
  });
};

// --- Single Shot Extraction (No Splitting) ---
export const extractProductsFromText = async (
  fullText: string, 
  apiKey: string,
  onProgress?: (current: number, total: number) => void
): Promise<ParsedProduct[]> => {
  if (!apiKey) throw new Error("请输入 OpenRouter API Key");

  if (onProgress) onProgress(50, 100);

  try {
    console.log(`[Extraction] Sending full text length: ${fullText.length} to model.`);
    
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": window.location.origin,
        "X-Title": "SKU Generator"
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: SYSTEM_PROMPT_EXTRACT },
          { role: "user", content: fullText }
        ],
        response_format: {
          type: "json_schema",
          json_schema: EXTRACT_JSON_SCHEMA
        },
        max_tokens: 100000 // Allow large output for many SKUs
      })
    });

    if (onProgress) onProgress(90, 100);

    const responseBodyText = await response.text();
    
    if (!response.ok) {
      let errorMsg = `API Error: ${response.status}`;
      try {
        const errorJson = JSON.parse(responseBodyText);
        if (errorJson.error && errorJson.error.message) {
          errorMsg = errorJson.error.message;
        }
      } catch { /* ignore */ }
      throw new ApiError(errorMsg, responseBodyText);
    }

    const data = JSON.parse(responseBodyText);
    const contentStr = data.choices?.[0]?.message?.content;
    
    if (!contentStr) throw new ApiError("Empty Content", responseBodyText);

    const parsedObj = safeJsonParse(contentStr, "ExtractSingleShot");
    const rawProducts = parsedObj?.products || [];
    
    // Apply normalization to fix symbols/rendering before returning
    const normalizedProducts = normalizeProductData(rawProducts);

    if (onProgress) onProgress(100, 100);
    return normalizedProducts;

  } catch (error) {
    console.error("[Extraction] Failed:", error);
    throw error;
  }
};

// --- RENAME LOGIC ---
export const renameProductNames = async (
  names: string[],
  apiKey: string,
  customPrompt?: string
): Promise<{original: string, new_name: string}[]> => {
  if (!apiKey) throw new Error("请输入 OpenRouter API Key");
  const systemPrompt = customPrompt || SYSTEM_PROMPT_RENAME;

  // Deduplicate input names to save tokens
  const uniqueNames = Array.from(new Set(names));
  if (uniqueNames.length === 0) return [];

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "SKU Generator"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ names: uniqueNames }) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: RENAME_JSON_SCHEMA
      }
    })
  });

  const responseBodyText = await response.text();
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  
  const data = JSON.parse(responseBodyText);
  const contentStr = data.choices?.[0]?.message?.content;
  const parsedObj = safeJsonParse(contentStr || "{}", "Rename");
  return parsedObj?.renamed_list || [];
};

// --- SKU OPTIMIZE LOGIC ---
export const optimizeSkuSpecs = async (
  specs: string[],
  apiKey: string,
  customPrompt?: string
): Promise<{original: string, optimized: string}[]> => {
  if (!apiKey) throw new Error("请输入 OpenRouter API Key");
  const systemPrompt = customPrompt || SYSTEM_PROMPT_SKU_OPTIMIZE;

  // Deduplicate
  const uniqueSpecs = Array.from(new Set(specs));
  if (uniqueSpecs.length === 0) return [];

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "SKU Generator"
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify({ specs: uniqueSpecs }) }
      ],
      response_format: {
        type: "json_schema",
        json_schema: SKU_OPTIMIZE_JSON_SCHEMA
      }
    })
  });

  const responseBodyText = await response.text();
  if (!response.ok) throw new Error(`API Error: ${response.status}`);
  
  const data = JSON.parse(responseBodyText);
  const contentStr = data.choices?.[0]?.message?.content;
  const parsedObj = safeJsonParse(contentStr || "{}", "SkuOptimize");
  return parsedObj?.optimized_list || [];
};

// Keep deprecated filter export to avoid breakages if used elsewhere, but marked as such
export const filterIrrelevantRows = async (rows: any[], apiKey: string, p?: string) => [];