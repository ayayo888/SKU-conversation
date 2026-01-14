import React, { useRef, useState, useEffect, useMemo } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { CleanerRow } from '../types';
import { ContentEditorModal } from './ContentEditorModal';

interface DataGridProps {
  data: CleanerRow[];
  headers: string[];
  onImportData: (data: CleanerRow[], headers: string[]) => void;
  onCellEdit: (rowId: number | string, column: string, value: any) => void;
}

// Strictly matched Instruction Mapping based on `模板说明.md`
const HEADER_INSTRUCTIONS: Record<string, string> = {
  '商品名称': '必填。若有多个SKU，一行一个SKU，商品级的信息需重复填写。',
  '商品价格': '<当前售价> 若无多个SKU则必填；若有多个SKU则不填（会默认改用SKU未划线价最低的）。',
  '商品拼单价': '若无多个SKU则选填；若有多个SKU则不填（会默认改用SKU拼单价最低的）。',
  '商品划线价': '<建议零售价/吊牌价/市场价> 选填。',
  '商品成本价': '无多个SKU则选填；若有多个SKU则不填。',
  '商品库存': '<SKU总库存> 若无多个SKU则选填；若有多个SKU则不填（会默认改用SKU库存之和）。',
  '商品重量': '<单位Kg，不小于0.001> 若无多个SKU则选填；若有多个SKU则不填。',
  '长': '<单位mm，大于0的整数>',
  '宽': '<单位mm，大于0的整数>',
  '高': '<单位mm，大于0的整数>',
  '商品商家编码': '<ERP等商家系统中的编码> 选填。',
  '商品条形码': '选填。',
  'SKU规格': '规格名+英文冒号+规格值；多维规格之间加英文分号（例如 颜色:红;尺码:L）。若有多个SKU则必填；若无多个SKU则不填。',
  'SKU划线价': '若有多个SKU则选填；若无多个SKU则不填。',
  'SKU价格': '<当前售价> 若有多个SKU则必填；若无多个SKU则不填。',
  'SKU拼单价': '若有多个SKU则选填；若无多个SKU则不填。',
  'SKU成本价': '选填。',
  'SKU库存': '选填。',
  'SKU重量': '<单位Kg，不小于0.001> 若有多个SKU则选填；若无多个SKU则不填。',
  'SKU商家编码': '<ERP系统中的SKU编码> 若有多个SKU则选填；若无多个SKU则不填。',
  'SKU条形码': '选填。',
  '商品主图': '选填。多个网络图片链接之间加英文逗号。',
  'SKU主规格图': '若有多个SKU，则选填。多个网络图片链接之间加英文逗号。',
  '商品详情': '选填。详情图文html源码。',
  '商品类目': '<行业类目> 上级类目+两个英文大于号+下级类目。选填。',
  '商品分组': '上级分组+两个英文大于号+下级分组，最大支持2级分组，多个分组之间加英文逗号。选填。',
  '商品属性': '属性名+英文冒号+属性值，多组属性之间加用英文分号。选填。',
  '商品卖点': '选填。',
  '透明素材图': '选填 (多个网络图片链接之间加英文逗号)。',
  '商品竖图': '选填 (多个网络图片链接之间加英文逗号)。',
  '商品长图': '<商品活动图/商品3:4主图>，选填 (多个网络图片链接之间加英文逗号)。',
  '主图视频': '选填 (填写可访问的URL)。'
};

// Fields that should be exported as Numbers, not Strings
const NUMERIC_FIELDS = new Set([
  '商品价格', '商品拼单价', '商品划线价', '商品成本价', '商品库存', '商品重量',
  '长', '宽', '高',
  'SKU划线价', 'SKU价格', 'SKU拼单价', 'SKU成本价', 'SKU库存', 'SKU重量'
]);

// Special Columns Config
const HTML_COLUMNS = new Set(['商品详情']);
const IMAGE_COLUMNS = new Set(['商品主图', 'SKU主规格图', '透明素材图', '商品竖图', '商品长图']);

// Icon for the filter button
const FilterIcon = ({ active }: { active: boolean }) => (
  <svg 
    className={`w-3 h-3 ${active ? 'text-[#0078D7]' : 'text-[#A0A0A0]'} transition-colors duration-200`} 
    fill="currentColor" 
    viewBox="0 0 24 24"
  >
    <path d="M10 18h4v-2h-4v2zM3 6v2h18V6H3zm3 7h12v-2H6v2z"/>
  </svg>
);

// Icon for Edit Button
const EditIcon = () => (
  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

export const DataGrid: React.FC<DataGridProps> = ({ data, headers, onImportData, onCellEdit }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // -- Export Menu State --
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // -- Filter System State --
  const [openFilterHeader, setOpenFilterHeader] = useState<string | null>(null);
  const [activeFilters, setActiveFilters] = useState<Record<string, Set<string>>>({});
  const [uniqueColumns, setUniqueColumns] = useState<Set<string>>(new Set());
  const [tempFilterSelection, setTempFilterSelection] = useState<Set<string>>(new Set());

  const filterMenuRef = useRef<HTMLDivElement>(null);

  // -- Modal State --
  const [modalConfig, setModalConfig] = useState<{
    isOpen: boolean;
    rowId: number | string | null;
    field: string;
    value: string;
    type: 'html' | 'images';
  }>({
    isOpen: false,
    rowId: null,
    field: '',
    value: '',
    type: 'html'
  });

  // Close menus when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setIsExportMenuOpen(false);
      }
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setOpenFilterHeader(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // -- Reset filters when data is cleared --
  useEffect(() => {
    if (data.length === 0) {
      setActiveFilters({});
      setUniqueColumns(new Set());
    }
  }, [data]);

  // -- Filter Logic Helpers --

  const getUniqueStats = (column: string) => {
    const stats = new Map<string, number>();
    
    data.forEach(row => {
      let val = row[column];
      if (val === null || val === undefined) {
        val = '(空白)';
      } else {
        val = String(val).trim();
        if (val === '') val = '(空白)';
      }
      stats.set(val, (stats.get(val) || 0) + 1);
    });

    return Array.from(stats.entries()).sort((a, b) => {
       const countDiff = b[1] - a[1];
       if (countDiff !== 0) return countDiff;
       if (a[0] === '(空白)') return 1;
       if (b[0] === '(空白)') return -1;
       return a[0].localeCompare(b[0]);
    });
  };

  const handleFilterClick = (header: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (openFilterHeader !== header) {
      const stats = getUniqueStats(header);
      const allValues = stats.map(s => s[0]);
      if (activeFilters[header]) {
        setTempFilterSelection(new Set(activeFilters[header]));
      } else {
        setTempFilterSelection(new Set(allValues));
      }
      setOpenFilterHeader(header);
    } else {
      setOpenFilterHeader(null);
    }
  };

  const toggleFilterValue = (val: string) => {
    const newSet = new Set(tempFilterSelection);
    if (newSet.has(val)) {
      newSet.delete(val);
    } else {
      newSet.add(val);
    }
    setTempFilterSelection(newSet);
  };

  const toggleSelectAll = (allValues: string[]) => {
    if (tempFilterSelection.size === allValues.length) {
      setTempFilterSelection(new Set());
    } else {
      setTempFilterSelection(new Set(allValues));
    }
  };

  const applyFilter = () => {
    if (!openFilterHeader) return;
    const stats = getUniqueStats(openFilterHeader);
    const allValues = stats.map(s => s[0]);
    const newFilters = { ...activeFilters };
    if (tempFilterSelection.size === allValues.length) {
      delete newFilters[openFilterHeader];
    } else {
      newFilters[openFilterHeader] = tempFilterSelection;
    }
    setActiveFilters(newFilters);
    setOpenFilterHeader(null);
  };

  const handleToggleUniqueMode = (header: string) => {
    const newUniqueSet = new Set(uniqueColumns);
    if (newUniqueSet.has(header)) {
      newUniqueSet.delete(header);
    } else {
      newUniqueSet.add(header);
      const newFilters = { ...activeFilters };
      delete newFilters[header];
      setActiveFilters(newFilters);
    }
    setUniqueColumns(newUniqueSet);
    setOpenFilterHeader(null); 
  };

  // -- Derived Data --
  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    let result = data.filter(row => {
      return Object.keys(activeFilters).every(colKey => {
        const allowedValues = activeFilters[colKey];
        if (!allowedValues) return true;

        let cellValue = row[colKey];
        if (cellValue === null || cellValue === undefined) {
          cellValue = '(空白)';
        } else {
          cellValue = String(cellValue).trim();
          if (cellValue === '') cellValue = '(空白)';
        }
        return allowedValues.has(cellValue);
      });
    });

    if (uniqueColumns.size > 0) {
      const seenMaps: Record<string, Set<string>> = {};
      uniqueColumns.forEach(col => {
        seenMaps[col] = new Set();
      });

      result = result.filter(row => {
        let isDuplicate = false;
        for (const col of uniqueColumns) {
          let val = row[col];
          if (val === null || val === undefined) {
            val = '(空白)';
          } else {
            val = String(val).trim();
            if (val === '') val = '(空白)';
          }

          if (seenMaps[col].has(val)) {
            isDuplicate = true;
          }
        }

        if (isDuplicate) return false;

        for (const col of uniqueColumns) {
          let val = row[col];
          if (val === null || val === undefined) {
            val = '(空白)';
          } else {
            val = String(val).trim();
            if (val === '') val = '(空白)';
          }
          seenMaps[col].add(val);
        }
        return true;
      });
    }

    return result;
  }, [data, activeFilters, uniqueColumns]);

  // -- Standard Handlers --

  const handleExport = (format: 'xlsx' | 'csv') => {
    setIsExportMenuOpen(false);
    if (filteredData.length === 0) {
      alert("表格为空或筛选结果为空");
      return;
    }

    // Determine filename from the first row's '商品名称'
    let fileName = 'sku_data_export';
    const firstRowName = filteredData[0]['商品名称'];
    if (firstRowName && typeof firstRowName === 'string') {
       const cleanName = firstRowName.trim().replace(/[\\/:*?"<>|]/g, "_").slice(0, 100);
       if (cleanName) {
         fileName = cleanName;
       }
    }

    const exportHeaders = headers.filter(h => h !== '状态');

    const instructionRow = exportHeaders.map(h => HEADER_INSTRUCTIONS[h] || "");
    const headerRow = exportHeaders;
    
    const dataRows = filteredData.map(row => {
      return exportHeaders.map(h => {
        const val = row[h] ?? "";
        if (NUMERIC_FIELDS.has(h) && val !== "" && !isNaN(Number(val))) {
          return Number(val);
        }
        return val;
      });
    });

    const exportData = [instructionRow, headerRow, ...dataRows];

    const ws = utils.aoa_to_sheet(exportData);
    const wb = utils.book_new();
    utils.book_append_sheet(wb, ws, "Sheet1");
    writeFile(wb, `${fileName}.${format === 'csv' ? 'csv' : 'xlsx'}`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();

    const processData = (arrayBuffer: ArrayBuffer | string, isBinary: boolean) => {
      try {
        const workbook = read(arrayBuffer, { type: isBinary ? 'array' : 'string', cellDates: true, cellNF: true, cellText: false });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = utils.sheet_to_json<any[]>(worksheet, { header: 1, defval: "", raw: false });
        processRawGrid(jsonData);
      } catch (error) {
        console.error(error);
        alert("文件解析失败");
      }
    };

    if (fileExt === 'csv') {
      reader.onload = (e) => processData(e.target?.result as string, false);
      reader.readAsText(file);
    } else {
      reader.onload = (e) => processData(e.target?.result as ArrayBuffer, true);
      reader.readAsArrayBuffer(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const processRawGrid = (rows: any[][]) => {
    if (!rows || rows.length === 0) return;

    let headerRowIndex = 0;
    const requiredKeys = ['商品名称', '商品价格'];
    let foundHeader = false;

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const rowStr = rows[i].map(cell => String(cell || "").trim());
        const matchCount = requiredKeys.filter(key => rowStr.includes(key)).length;
        if (matchCount === requiredKeys.length) {
            headerRowIndex = i;
            foundHeader = true;
            break;
        }
    }
    
    if (!foundHeader) {
        console.warn("Could not find standard headers (商品名称, 商品价格). Defaulting to first row.");
    }

    const rawHeaders = rows[headerRowIndex].map(h => String(h || "").trim());
    const validHeaderIndices = rawHeaders.map((h, i) => ({ h, i })).filter(item => item.h && item.h !== '状态');
    
    const parsedRows: CleanerRow[] = [];
    
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
      const rowArr = rows[i];
      if (!rowArr || rowArr.every(c => c === "" || c === null || c === undefined)) continue;
      
      const rowObj: CleanerRow = { 
        _internal_id: Date.now() + i + Math.random(),
        checkStatus: 'unverified'
      }; 
      
      validHeaderIndices.forEach(({ h, i }) => {
        rowObj[h] = rowArr[i];
      });
      
      parsedRows.push(rowObj);
    }
    
    if (parsedRows.length === 0) {
        alert("未找到有效数据。请检查 Excel 文件格式是否符合【模板说明】。");
        return;
    }

    setActiveFilters({});
    setUniqueColumns(new Set());
    
    onImportData(parsedRows, []); 
  };

  // -- Modal Handler --
  const handleOpenEditor = (rowId: number | string, field: string, value: string, type: 'html' | 'images') => {
    setModalConfig({
      isOpen: true,
      rowId,
      field,
      value: value || '',
      type
    });
  };

  const handleModalSave = (newValue: string) => {
    if (modalConfig.rowId && modalConfig.field) {
      onCellEdit(modalConfig.rowId, modalConfig.field, newValue);
    }
    setModalConfig(prev => ({ ...prev, isOpen: false }));
  };

  return (
    <div className="flex flex-col h-full bg-white relative">
      <ContentEditorModal 
        isOpen={modalConfig.isOpen}
        title={modalConfig.field}
        initialValue={modalConfig.value}
        type={modalConfig.type}
        onClose={() => setModalConfig(prev => ({ ...prev, isOpen: false }))}
        onSave={handleModalSave}
      />

      {/* Toolbar */}
      <div className="px-2 py-1 bg-[#F3F3F3] border-b border-[#E5E5E5] flex justify-between items-center h-[36px]">
        <div className="flex items-center gap-2">
           <span className="text-xs text-[#333333]">
             显示: {filteredData.length} / 总计: {data.length}
             {uniqueColumns.size > 0 && (
               <span className="ml-2 text-[#0078D7] font-semibold">
                 (已去重: {Array.from(uniqueColumns).join(', ')})
               </span>
             )}
           </span>
        </div>
        
        <div className="flex items-center gap-1">
          <input type="file" accept=".csv, .xlsx, .xls" ref={fileInputRef} onChange={handleFileChange} className="hidden" />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1 text-xs text-[#333333] hover:bg-[#D9D9D9] transition-colors border border-transparent hover:border-[#CCCCCC] rounded-none"
          >
            导入 Excel/CSV
          </button>
          
          <div className="relative" ref={exportMenuRef}>
            <button 
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="px-3 py-1 text-xs text-[#333333] hover:bg-[#D9D9D9] transition-colors border border-transparent hover:border-[#CCCCCC] rounded-none"
            >
              导出
            </button>
            {isExportMenuOpen && (
              <div className="absolute right-0 top-full mt-0 w-32 bg-white border border-[#CCCCCC] shadow-md z-50 py-1 text-xs">
                <button onClick={() => handleExport('xlsx')} className="block w-full text-left px-3 py-2 hover:bg-[#F0F0F0] text-[#333333]">Excel (.xlsx)</button>
                <button onClick={() => handleExport('csv')} className="block w-full text-left px-3 py-2 hover:bg-[#F0F0F0] text-[#333333]">CSV (.csv)</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-auto flex-1 bg-white relative scrollbar-win10">
        <table className="w-max min-w-full text-sm text-left border-collapse">
          <thead className="bg-white sticky top-0 z-10 shadow-sm">
            <tr>
              <th className="w-8 border-b border-r border-[#D9D9D9] bg-[#F5F5F5] text-center"></th>
              {headers.map((h, i) => {
                 const isFilterActive = !!activeFilters[h] || uniqueColumns.has(h);
                 const isMenuOpen = openFilterHeader === h;

                 return (
                   <th key={i} className="relative px-2 py-1 border-b border-r border-[#D9D9D9] font-normal text-xs text-[#333333] h-[30px] hover:bg-[#EBEBEB] group select-none">
                     <div className="flex items-center justify-between w-full h-full gap-2">
                       <span className="whitespace-nowrap font-semibold">{h}</span>
                       <button 
                          onClick={(e) => handleFilterClick(h, e)}
                          title="筛选"
                          className={`p-1 rounded hover:bg-[#DADADA] focus:outline-none flex-shrink-0`}
                       >
                         <FilterIcon active={isFilterActive} />
                       </button>
                     </div>

                     {/* Filter Dropdown Menu */}
                     {isMenuOpen && (
                       <div 
                         ref={filterMenuRef}
                         className="absolute left-0 top-full mt-0 w-64 bg-white border border-[#CCCCCC] shadow-[3px_3px_10px_rgba(0,0,0,0.15)] z-50 flex flex-col font-normal"
                         onClick={(e) => e.stopPropagation()}
                       >
                         {(() => {
                           const stats = getUniqueStats(h);
                           const allValues = stats.map(s => s[0]);
                           const isAllSelected = tempFilterSelection.size === allValues.length;
                           const isUniqueModeActive = uniqueColumns.has(h);

                           return (
                             <>
                               <div className="flex justify-between p-2 border-b border-[#E5E5E5] bg-[#F9F9F9]">
                                 <button onClick={applyFilter} className="text-xs px-4 py-1 bg-[#0078D7] text-white hover:bg-[#006CC1] transition-colors border border-transparent">确定</button>
                                 <button onClick={() => setOpenFilterHeader(null)} className="text-xs px-4 py-1 border border-[#CCCCCC] bg-white hover:bg-[#F0F0F0] text-[#333333] transition-colors">取消</button>
                               </div>

                               <div className="px-2 py-1.5 border-b border-[#E5E5E5] bg-white flex justify-center">
                                  <button 
                                    onClick={() => handleToggleUniqueMode(h)}
                                    className={`w-full text-xs py-1 border transition-colors flex items-center justify-center gap-1
                                      ${isUniqueModeActive 
                                        ? 'bg-[#E5F1FB] border-[#0078D7] text-[#0078D7] font-bold' 
                                        : 'bg-[#F0F0F0] border-[#CCCCCC] text-[#333333] hover:bg-[#E0E0E0]'
                                      }
                                    `}
                                    title="将重复出现的项合并，每个值只保留一行"
                                  >
                                    {isUniqueModeActive ? (
                                      <>✓ 已去重 (显示全部)</>
                                    ) : (
                                      <>✦ 筛选唯一项 (去重)</>
                                    )}
                                  </button>
                               </div>

                               <div className="max-h-60 overflow-y-auto p-2 scrollbar-win10 bg-white">
                                    <div className="flex flex-col gap-1">
                                      <label className="flex items-center gap-2 px-1 py-1 hover:bg-[#F0F0F0] cursor-pointer select-none">
                                        <input 
                                          type="checkbox" 
                                          checked={isAllSelected}
                                          onChange={() => toggleSelectAll(allValues)}
                                          className="accent-[#0078D7] w-3.5 h-3.5"
                                        />
                                        <span className="text-xs text-[#333333] font-semibold">(全选)</span>
                                      </label>
                                      
                                      <div className="h-[1px] bg-[#E5E5E5] my-1"></div>
                                      
                                      {stats.map(([val, count]) => (
                                        <label key={val} className="flex items-center gap-2 px-1 py-0.5 hover:bg-[#F0F0F0] cursor-pointer select-none">
                                          <input 
                                            type="checkbox" 
                                            checked={tempFilterSelection.has(val)}
                                            onChange={() => toggleFilterValue(val)}
                                            className="accent-[#0078D7] w-3.5 h-3.5"
                                          />
                                          <span className="text-xs text-[#333333] truncate flex-1" title={val}>{val}</span>
                                          <span className="text-xs text-[#888888]">({count})</span>
                                        </label>
                                      ))}
                                    </div>
                               </div>
                             </>
                           );
                         })()}
                       </div>
                     )}
                   </th>
                 );
              })}
            </tr>
          </thead>
          <tbody>
            {filteredData.map((row, rIdx) => (
              <tr key={row._internal_id || rIdx} className="hover:bg-[#E5F3FF] group border-b border-[#F0F0F0]">
                <td className="w-8 border-r border-[#F0F0F0] bg-[#F9F9F9] text-center text-[10px] text-[#999999] select-none">
                  {rIdx + 1}
                </td>
                {headers.map((header, cIdx) => {
                    if (header === '状态') {
                      const isVerified = row.checkStatus === 'verified';
                      return (
                        <td key={cIdx} className="px-2 border-r border-[#F0F0F0] text-xs w-[60px]">
                          <span className={isVerified ? 'text-green-600' : 'text-gray-400'}>
                            {isVerified ? '●' : '○'}
                          </span>
                        </td>
                      );
                    }

                    const val = row[header] ?? "";
                    
                    // -- SPECIAL HANDLING FOR RICH CONTENT COLUMNS --
                    const isHtml = HTML_COLUMNS.has(header);
                    const isImages = IMAGE_COLUMNS.has(header);

                    if (isHtml || isImages) {
                       return (
                         <td 
                            key={cIdx} 
                            className="border-r border-[#F0F0F0] p-0 min-w-[150px] relative group/cell cursor-pointer hover:bg-[#F0F0F0]"
                            onClick={() => handleOpenEditor(row._internal_id!, header, val, isHtml ? 'html' : 'images')}
                            title="点击编辑详情/预览图片"
                         >
                            <div className="w-full h-full px-2 py-1.5 text-xs text-[#333333] truncate relative">
                               {val}
                               <div className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 opacity-0 group-hover/cell:opacity-100 transition-opacity">
                                  <EditIcon />
                               </div>
                            </div>
                         </td>
                       );
                    }

                    // -- STANDARD TEXT INPUT --
                    return (
                      <td key={cIdx} className="border-r border-[#F0F0F0] p-0 min-w-[100px]">
                        <input 
                          value={val}
                          onChange={(e) => onCellEdit(row._internal_id!, header, e.target.value)}
                          className="w-full h-full px-2 py-1.5 bg-transparent border-none focus:ring-1 focus:ring-inset focus:ring-[#0078D7] text-xs text-[#333333]"
                        />
                      </td>
                    );
                })}
              </tr>
            ))}
            {filteredData.length === 0 && (
              <tr>
                <td colSpan={headers.length + 1} className="text-center py-10 text-[#999999] text-xs">
                  {data.length > 0 ? "没有符合筛选条件的数据" : "暂无数据，请导入或使用左侧工具提取"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};