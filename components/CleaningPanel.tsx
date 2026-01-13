import React, { useState, useEffect } from 'react';
import { CleanerRow, ParsedProduct } from '../types';
import { 
  extractProductsFromText, 
  renameProductNames, 
  optimizeSkuSpecs,
  ApiError, 
  SYSTEM_PROMPT_RENAME,
  SYSTEM_PROMPT_SKU_OPTIMIZE 
} from '../services/openRouterService';

interface CleaningPanelProps {
  currentRows: CleanerRow[];
  onAddRows: (newRows: CleanerRow[]) => void;
  onRemoveRows: (ids: (string | number)[]) => void;
  onUpdateStatus: (ids: (string | number)[], status: 'verified' | 'unverified') => void;
  onBatchUpdate: (updates: { id: string | number; changes: Partial<CleanerRow> }[]) => void;
  onClearAll: () => void;
}

export const CleaningPanel: React.FC<CleaningPanelProps> = ({ currentRows, onAddRows, onRemoveRows, onUpdateStatus, onBatchUpdate, onClearAll }) => {
  const [activeTab, setActiveTab] = useState<'initial' | 'renaming' | 'sku_optimization' | 'detail_images'>('initial');
  const [apiKey, setApiKey] = useState('');
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [debugLog, setDebugLog] = useState<string | null>(null);

  // Detail Images State
  const [headerImages, setHeaderImages] = useState<string[]>(['', '', '']);
  const [footerImages, setFooterImages] = useState<string[]>(['', '', '']);

  // Reset Confirmation State
  const [isConfirmingReset, setIsConfirmingReset] = useState(false);

  // Prompts
  const [renamePrompt, setRenamePrompt] = useState(SYSTEM_PROMPT_RENAME);
  const [skuPrompt, setSkuPrompt] = useState(SYSTEM_PROMPT_SKU_OPTIMIZE);

  // Count Unique Stats
  const uniqueProducts = new Set(currentRows.map(r => r['商品名称']));
  const uniqueSkuSpecs = new Set(currentRows.map(r => r['SKU规格']).filter(Boolean));

  useEffect(() => {
    const storedKey = localStorage.getItem('openrouter_api_key');
    if (storedKey) setApiKey(storedKey);
  }, []);

  // Auto-cancel reset confirmation after 3 seconds
  useEffect(() => {
    if (isConfirmingReset) {
      const timer = setTimeout(() => setIsConfirmingReset(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isConfirmingReset]);

  const handleSaveKey = (val: string) => {
    setApiKey(val);
    localStorage.setItem('openrouter_api_key', val);
  };

  const handleClearKey = () => {
    setApiKey('');
    localStorage.removeItem('openrouter_api_key');
  };

  const handleInitialCleaning = async () => {
    if (!inputText.trim()) { alert("请输入需要提取的内容"); return; }
    if (!apiKey) { alert("请先输入 OpenRouter API Key"); return; }

    setIsLoading(true);
    setStatus("AI 正在深度思考并提取 SKU (不拆分文本)...");
    setDebugLog(null);

    try {
      const onProgress = (current: number, total: number) => {
        if (current === 100) {
            setStatus("解析完成，正在渲染表格...");
        } else {
            setStatus(`AI 处理中... ${current}%`);
        }
      };

      // Calling the service - SINGLE SHOT
      const parsedData = await extractProductsFromText(inputText, apiKey, onProgress);
      
      if (parsedData.length === 0) {
        setStatus("未提取到数据，请检查输入或 Key 配额。");
        setIsLoading(false);
        return;
      }

      const newRows: CleanerRow[] = [];
      let duplicateCount = 0;
      const existingKeys = new Set(currentRows.map(r => `${r['商品名称']}-${r['SKU规格']}`));

      const productGroups: Record<string, ParsedProduct[]> = {};
      parsedData.forEach(p => {
        const name = p.productName || "未命名商品";
        if (!productGroups[name]) productGroups[name] = [];
        productGroups[name].push(p);
      });

      // --- TIMESTAMP ID GENERATION ---
      const now = new Date();
      const timestampId = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
      let productCounter = 0;

      Object.values(productGroups).forEach((group) => {
        const isMultiSKU = group.length > 1;
        productCounter++;
        let masterProductCode = '';
        
        const aiCode = group[0]?.skuCode || '';
        const cleanedAiCode = aiCode.replace(/[\u4e00-\u9fa5]/g, '').trim();

        if (cleanedAiCode && cleanedAiCode.length > 2) {
          masterProductCode = cleanedAiCode;
        } else {
          masterProductCode = `${timestampId}${String(productCounter).padStart(3, '0')}`;
        }

        group.forEach((p, index) => {
            const uniqueKey = `${p.productName}-${p.specs}`;
        
            if (existingKeys.has(uniqueKey)) {
              duplicateCount++;
              return;
            }
            existingKeys.add(uniqueKey);

            let finalSkuCode = '';
            const aiSkuCode = p.skuCode || '';
            const cleanedSkuCode = aiSkuCode.replace(/[\u4e00-\u9fa5]/g, '').trim();

            if (cleanedSkuCode && cleanedSkuCode.length > 2) {
               finalSkuCode = cleanedSkuCode;
            } else {
               finalSkuCode = `${masterProductCode}${String(index + 1).padStart(2, '0')}`;
            }

            newRows.push({
                _internal_id: Date.now() + Math.random(),
                checkStatus: 'unverified',
                '商品名称': p.productName,
                '商品商家编码': masterProductCode, 
                '商品主图': p.images,
                '商品详情': p.detailHtml,
                '商品卖点': p.description,
                '商品类目': p.category,
                '商品价格': isMultiSKU ? '' : p.price,
                '商品库存': isMultiSKU ? '' : p.stock,
                'SKU规格': isMultiSKU ? p.specs : '', 
                'SKU价格': isMultiSKU ? p.price : '',
                'SKU库存': isMultiSKU ? p.stock : '',
                'SKU商家编码': isMultiSKU ? finalSkuCode : '',
                'SKU主规格图': isMultiSKU ? (p.skuImage || '') : '',
                '商品拼单价': '', 
                '商品划线价': '', 
                '商品成本价': '', 
                '商品重量': '',
                '长': '', '宽': '', '高': '', 
                '商品条形码': '',
                'SKU划线价': '', 
                'SKU拼单价': '', 
                'SKU成本价': '', 
                'SKU重量': '', 
                'SKU条形码': '',
                '商品分组': '', 
                '商品属性': '', 
                '透明素材图': '', 
                '商品竖图': '', 
                '商品长图': '', 
                '主图视频': ''
            });
        });
      });

      onAddRows(newRows);
      setStatus(`提取成功: 生成 ${parsedData.length} 个 SKU (新增 ${newRows.length}，重复过滤 ${duplicateCount})`);
      
    } catch (e: any) {
      console.error(e);
      setStatus(`Error: ${e.message}`);
      if (e instanceof ApiError && e.rawResponse) {
         setDebugLog(e.rawResponse);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleRename = async () => {
    if (currentRows.length === 0) { alert("表格无数据"); return; }
    if (!apiKey) { alert("请输入 API Key"); return; }
    if (!renamePrompt.trim()) { alert("提示词不能为空"); return; }
    
    // Get unique product names to save tokens
    const uniqueNames = Array.from(new Set(
      currentRows
        .map(r => String(r['商品名称'] || ''))
        .filter(n => n.length > 0)
    )) as string[];
    
    if (uniqueNames.length === 0) {
      setStatus("没有找到有效的商品名称");
      return;
    }

    setIsLoading(true);
    setStatus(`正在重命名 ${uniqueNames.length} 个独立商品 (包含 ${currentRows.length} 行数据)...`);
    setDebugLog(null);

    try {
      const results = await renameProductNames(uniqueNames, apiKey, renamePrompt);
      
      if (!results || results.length === 0) {
        setStatus("AI 未返回任何结果");
        setIsLoading(false);
        return;
      }

      // Create a map for fast lookup: Old Name -> New Name
      const renameMap = new Map<string, string>();
      results.forEach(item => {
        renameMap.set(item.original, item.new_name);
      });

      // Prepare batch update
      const updates = currentRows
        .filter(row => renameMap.has(row['商品名称'] || ''))
        .map(row => ({
           id: row._internal_id!,
           changes: { '商品名称': renameMap.get(row['商品名称']!) }
        }));

      if (updates.length > 0) {
        onBatchUpdate(updates);
        setStatus(`完成: 成功重命名 ${updates.length} 行数据`);
      } else {
        setStatus("未产生任何变动");
      }

    } catch (e: any) {
      console.error(e);
      setStatus(`Error: ${e.message}`);
      if (e instanceof ApiError && e.rawResponse) {
         setDebugLog(e.rawResponse);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSkuOptimize = async () => {
     if (currentRows.length === 0) { alert("表格无数据"); return; }
     if (!apiKey) { alert("请输入 API Key"); return; }
     if (!skuPrompt.trim()) { alert("提示词不能为空"); return; }

     // Get unique SKU specs
     const uniqueSpecs = Array.from(new Set(
       currentRows
         .map(r => String(r['SKU规格'] || ''))
         .filter(s => s.length > 0)
     )) as string[];

     if (uniqueSpecs.length === 0) {
       setStatus("没有找到有效的 SKU 规格数据");
       return;
     }

     setIsLoading(true);
     setStatus(`正在优化 ${uniqueSpecs.length} 个独立 SKU 规格 (包含 ${currentRows.length} 行数据)...`);
     setDebugLog(null);

     try {
       const results = await optimizeSkuSpecs(uniqueSpecs, apiKey, skuPrompt);
       
       if (!results || results.length === 0) {
         setStatus("AI 未返回任何结果");
         setIsLoading(false);
         return;
       }

       const optimizeMap = new Map<string, string>();
       results.forEach(item => {
         optimizeMap.set(item.original, item.optimized);
       });

       const updates = currentRows
         .filter(row => optimizeMap.has(row['SKU规格'] || ''))
         .map(row => ({
           id: row._internal_id!,
           changes: { 'SKU规格': optimizeMap.get(row['SKU规格']!) }
         }));

       if (updates.length > 0) {
         onBatchUpdate(updates);
         setStatus(`完成: 成功优化 ${updates.length} 行 SKU 规格`);
       } else {
         setStatus("未产生任何变动");
       }
     } catch (e: any) {
       console.error(e);
       setStatus(`Error: ${e.message}`);
       if (e instanceof ApiError && e.rawResponse) {
          setDebugLog(e.rawResponse);
       }
     } finally {
       setIsLoading(false);
     }
  };

  const handleInsertDetailImages = () => {
    if (currentRows.length === 0) { alert("表格无数据"); return; }
    
    // Filter out empty lines
    const validHeaders = headerImages.filter(img => img.trim().length > 0);
    const validFooters = footerImages.filter(img => img.trim().length > 0);

    if (validHeaders.length === 0 && validFooters.length === 0) {
      alert("请至少输入一个图片链接");
      return;
    }

    setIsLoading(true);
    setStatus("正在批量插入图片...");

    // Construct HTML parts
    const headerHtml = validHeaders.map(url => `<p><img src="${url.trim()}" style="display:block;max-width:100%;margin:0 auto;" /></p>`).join('');
    const footerHtml = validFooters.map(url => `<p><img src="${url.trim()}" style="display:block;max-width:100%;margin:0 auto;" /></p>`).join('');

    const updates = currentRows.map(row => {
      const originalDetail = row['商品详情'] || '';
      // Don't duplicate if already exists (naive check) - Optional, but keeping it simple: just append/prepend
      const newDetail = `${headerHtml}${originalDetail}${footerHtml}`;
      
      return {
        id: row._internal_id!,
        changes: { '商品详情': newDetail }
      };
    });

    onBatchUpdate(updates);
    setStatus(`完成: 已向 ${updates.length} 个 SKU 的详情中插入图片`);
    setIsLoading(false);
  };

  const handleUpdateImageInput = (type: 'header' | 'footer', index: number, val: string) => {
    if (type === 'header') {
      const newArr = [...headerImages];
      newArr[index] = val;
      setHeaderImages(newArr);
    } else {
      const newArr = [...footerImages];
      newArr[index] = val;
      setFooterImages(newArr);
    }
  };

  // Comprehensive Reset Function
  const handleResetClick = () => {
    if (!isConfirmingReset) {
      setIsConfirmingReset(true);
      return;
    }
    setInputText('');
    setRenamePrompt(SYSTEM_PROMPT_RENAME); 
    setSkuPrompt(SYSTEM_PROMPT_SKU_OPTIMIZE);
    setHeaderImages(['', '', '']);
    setFooterImages(['', '', '']);
    setStatus('已重置所有数据');
    setDebugLog(null);
    setIsLoading(false);
    setIsConfirmingReset(false);
    onClearAll();
  };

  return (
    <div className="flex flex-col h-full bg-[#F3F3F3]">
      {/* API Key Input */}
      <div className="p-4 border-b border-[#E5E5E5] bg-white">
        <label className="block text-[11px] text-[#666666] mb-1">OpenRouter API Key</label>
        <div className="flex gap-1">
          <input 
            type="password" 
            value={apiKey}
            onChange={(e) => handleSaveKey(e.target.value)}
            placeholder="sk-..."
            className="flex-1 text-xs p-1.5 bg-white border border-[#999999] hover:border-[#666666] focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] outline-none transition-colors rounded-none placeholder-gray-400"
          />
          <button 
            onClick={handleClearKey} 
            title="清除 Key"
            className="px-2 bg-[#F0F0F0] border border-[#CCCCCC] hover:bg-[#E0E0E0] text-[#666666]"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex pl-4 pt-4 bg-[#F3F3F3] gap-4 overflow-x-auto scrollbar-hide">
        <button 
          onClick={() => setActiveTab('initial')}
          className={`pb-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${activeTab === 'initial' ? 'text-[#000000] border-b-2 border-[#0078D7]' : 'text-[#777777] hover:text-[#333333]'}`}
        >
          AI 提取
        </button>
        <button 
          onClick={() => setActiveTab('renaming')}
          className={`pb-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${activeTab === 'renaming' ? 'text-[#000000] border-b-2 border-[#0078D7]' : 'text-[#777777] hover:text-[#333333]'}`}
        >
          AI 改名
        </button>
        <button 
          onClick={() => setActiveTab('sku_optimization')}
          className={`pb-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${activeTab === 'sku_optimization' ? 'text-[#000000] border-b-2 border-[#0078D7]' : 'text-[#777777] hover:text-[#333333]'}`}
        >
          SKU 优化
        </button>
        <button 
          onClick={() => setActiveTab('detail_images')}
          className={`pb-2 text-[15px] font-semibold whitespace-nowrap transition-colors ${activeTab === 'detail_images' ? 'text-[#000000] border-b-2 border-[#0078D7]' : 'text-[#777777] hover:text-[#333333]'}`}
        >
          详情插图
        </button>
      </div>

      {/* Content Area */}
      <div className="flex-1 p-4 flex flex-col overflow-auto">
        
        {activeTab === 'initial' && (
          <div className="flex flex-col h-full gap-3">
            <textarea 
              className="flex-1 w-full p-2 text-xs bg-white border border-[#999999] hover:border-[#666666] focus:border-[#0078D7] outline-none font-mono resize-none rounded-none text-[#333333]"
              placeholder="请粘贴整个网页源码或文本 (包含HTML)... AI 将自动降噪并组合 SKU"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
            />
            
            <button 
              onClick={handleInitialCleaning}
              disabled={isLoading}
              className={`w-full py-1.5 text-white text-sm bg-[#0078D7] hover:bg-[#006CC1] active:bg-[#005A9E] disabled:bg-[#CCCCCC] disabled:text-[#666666] transition-colors border-none rounded-none shadow-none`}
            >
              {isLoading ? 'AI 思考中...' : '开始提取 SKU'}
            </button>
          </div>
        )}

        {activeTab === 'renaming' && (
          <div className="flex flex-col h-full gap-4">
            <div className="bg-white p-3 border border-[#D9D9D9]">
              <h3 className="text-xs font-bold text-[#333333] mb-2">待处理商品概览</h3>
              <div className="space-y-1">
                 <div className="flex justify-between text-xs">
                   <span className="text-[#666666]">独立商品数</span>
                   <span className="font-semibold text-[#000000]">{uniqueProducts.size}</span>
                 </div>
                 <div className="flex justify-between text-xs">
                   <span className="text-[#666666]">SKU 总行数</span>
                   <span className="font-semibold text-[#000000]">{currentRows.length}</span>
                 </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
               <div className="flex justify-between items-center mb-1">
                 <label className="text-[11px] text-[#666666]">AI 改名规则 (可编辑)</label>
                 <button 
                   onClick={() => setRenamePrompt(SYSTEM_PROMPT_RENAME)}
                   className="text-[10px] text-[#0078D7] hover:underline cursor-pointer"
                   title="恢复默认的改名规则"
                 >
                   恢复默认
                 </button>
               </div>
               <textarea 
                 className="flex-1 w-full p-2 text-xs bg-white border border-[#999999] hover:border-[#666666] focus:border-[#0078D7] outline-none font-mono resize-none rounded-none text-[#333333]"
                 value={renamePrompt}
                 onChange={(e) => setRenamePrompt(e.target.value)}
                 placeholder="在这里定义改名规则，例如：去品牌、翻译成英文、年份处理..."
               />
            </div>

            <button 
              onClick={handleRename}
              disabled={isLoading || currentRows.length === 0}
              className={`w-full py-1.5 text-white text-sm bg-[#0078D7] hover:bg-[#006CC1] active:bg-[#005A9E] disabled:bg-[#CCCCCC] disabled:text-[#666666] transition-colors border-none rounded-none`}
            >
              {isLoading ? 'AI 改名中...' : '开始 AI 改名'}
            </button>
          </div>
        )}

        {activeTab === 'sku_optimization' && (
          <div className="flex flex-col h-full gap-4">
             <div className="bg-white p-3 border border-[#D9D9D9]">
              <h3 className="text-xs font-bold text-[#333333] mb-2">待处理规格概览</h3>
              <div className="space-y-1">
                 <div className="flex justify-between text-xs">
                   <span className="text-[#666666]">独立 SKU 规格数</span>
                   <span className="font-semibold text-[#000000]">{uniqueSkuSpecs.size}</span>
                 </div>
                 <div className="flex justify-between text-xs">
                   <span className="text-[#666666]">涉及 SKU 行数</span>
                   <span className="font-semibold text-[#000000]">{currentRows.filter(r => r['SKU规格']).length}</span>
                 </div>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
               <div className="flex justify-between items-center mb-1">
                 <label className="text-[11px] text-[#666666]">AI 优化规则 (可编辑)</label>
                 <button 
                   onClick={() => setSkuPrompt(SYSTEM_PROMPT_SKU_OPTIMIZE)}
                   className="text-[10px] text-[#0078D7] hover:underline cursor-pointer"
                   title="恢复默认的优化规则"
                 >
                   恢复默认
                 </button>
               </div>
               <textarea 
                 className="flex-1 w-full p-2 text-xs bg-white border border-[#999999] hover:border-[#666666] focus:border-[#0078D7] outline-none font-mono resize-none rounded-none text-[#333333]"
                 value={skuPrompt}
                 onChange={(e) => setSkuPrompt(e.target.value)}
                 placeholder="定义 SKU 翻译规则，注意保留格式..."
               />
            </div>

            <button 
              onClick={handleSkuOptimize}
              disabled={isLoading || currentRows.length === 0}
              className={`w-full py-1.5 text-white text-sm bg-[#0078D7] hover:bg-[#006CC1] active:bg-[#005A9E] disabled:bg-[#CCCCCC] disabled:text-[#666666] transition-colors border-none rounded-none`}
            >
              {isLoading ? 'AI 优化中...' : '开始 SKU 优化'}
            </button>
          </div>
        )}

        {activeTab === 'detail_images' && (
          <div className="flex flex-col h-full gap-4">
            <div className="bg-white p-3 border border-[#D9D9D9]">
               <h3 className="text-xs font-bold text-[#333333] mb-2">批量插入图片 (Cloudinary/其他链接)</h3>
               <p className="text-[10px] text-[#666666] mb-2">
                 图片将以 HTML <code>&lt;img&gt;</code> 形式插入到所有“商品详情”单元格中。空输入框将被忽略。
               </p>
               
               {/* Header Inputs */}
               <div className="mb-4">
                 <label className="block text-[11px] text-[#0078D7] font-semibold mb-1">详情头部插入 (Top)</label>
                 <div className="space-y-1">
                   {headerImages.map((url, i) => (
                     <input 
                       key={`head-${i}`}
                       type="text"
                       placeholder={`头部图片链接 ${i+1}`}
                       value={url}
                       onChange={(e) => handleUpdateImageInput('header', i, e.target.value)}
                       className="w-full p-1.5 text-xs bg-white border border-[#CCCCCC] focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] outline-none transition-colors"
                     />
                   ))}
                 </div>
               </div>

               {/* Footer Inputs */}
               <div className="mb-2">
                 <label className="block text-[11px] text-[#0078D7] font-semibold mb-1">详情尾部插入 (Bottom)</label>
                 <div className="space-y-1">
                   {footerImages.map((url, i) => (
                     <input 
                       key={`foot-${i}`}
                       type="text"
                       placeholder={`尾部图片链接 ${i+1}`}
                       value={url}
                       onChange={(e) => handleUpdateImageInput('footer', i, e.target.value)}
                       className="w-full p-1.5 text-xs bg-white border border-[#CCCCCC] focus:border-[#0078D7] focus:ring-1 focus:ring-[#0078D7] outline-none transition-colors"
                     />
                   ))}
                 </div>
               </div>
            </div>

            <div className="flex-1"></div>

            <button 
              onClick={handleInsertDetailImages}
              disabled={isLoading || currentRows.length === 0}
              className={`w-full py-1.5 text-white text-sm bg-[#0078D7] hover:bg-[#006CC1] active:bg-[#005A9E] disabled:bg-[#CCCCCC] disabled:text-[#666666] transition-colors border-none rounded-none`}
            >
              {isLoading ? '处理中...' : '开始批量插入'}
            </button>
          </div>
        )}

        {/* Log Area */}
        <div className="mt-3 flex flex-col gap-2">
          {status && (
            <div className={`text-xs p-2 border-l-2 ${status.includes('Error') ? 'border-red-500 bg-red-50 text-red-700' : 'border-[#0078D7] bg-white text-[#333333]'}`}>
              {status}
            </div>
          )}
          
          {debugLog && (
            <div className="border border-red-200 bg-white">
              <div className="bg-red-50 px-2 py-1 text-[10px] text-red-600 border-b border-red-100 flex justify-between items-center">
                <span>API Raw Response (Error)</span>
                <button onClick={() => navigator.clipboard.writeText(debugLog)} className="hover:underline">Copy</button>
              </div>
              <div className="p-2 text-[10px] font-mono overflow-auto max-h-32 text-[#333333]">
                {debugLog}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer Actions (Reset Cache) */}
      <div className="p-4 border-t border-[#E5E5E5] bg-[#F9F9F9]">
         <div className="text-[10px] text-[#666666] mb-2 text-center">
            清理缓存与数据
         </div>
         <button
            onClick={handleResetClick}
            className={`w-full py-1.5 text-xs border transition-colors font-semibold
              ${isConfirmingReset 
                ? 'bg-red-600 text-white border-red-700 hover:bg-red-700' 
                : 'bg-white text-[#333333] border-[#999999] hover:bg-[#E5E5E5] hover:border-[#666666] active:bg-[#CCCCCC]'
              }
            `}
            title="此操作将清空表格数据和输入框内容"
          >
            {isConfirmingReset ? "确定要清空吗？(点击确认)" : "清空所有数据 (Reset All)"}
          </button>
      </div>
    </div>
  );
};