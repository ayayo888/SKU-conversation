import React, { useState, useEffect } from 'react';
import { DataGrid } from './components/DataGrid';
import { CleaningPanel } from './components/CleaningPanel';
import { CleanerRow } from './types';

// Updated Headers for SKU Generation
const HEADERS = [
  '状态',
  '商品名称', '商品价格', '商品拼单价', '商品划线价', '商品成本价', '商品库存', '商品重量', 
  '长', '宽', '高', '商品商家编码', '商品条形码', 
  'SKU规格', 'SKU划线价', 'SKU价格', 'SKU拼单价', 'SKU成本价', 'SKU库存', 'SKU重量', 'SKU商家编码', 'SKU条形码', 
  '商品主图', 'SKU主规格图', '商品详情', '商品类目', '商品分组', '商品属性', '商品卖点', 
  '透明素材图', '商品竖图', '商品长图', '主图视频'
];

const INITIAL_ROWS: CleanerRow[] = [
  {
    _internal_id: 1,
    checkStatus: 'unverified',
    '商品名称': '茵曼2019夏装新款亚麻棉小清新提花文艺A摆简约百搭休闲半身裙女',
    '商品价格': '178',
    '商品拼单价': '177',
    '商品划线价': '198',
    '商品成本价': '220',
    '商品库存': '4',
    '商品重量': '',
    '长': '',
    '宽': '',
    '高': '',
    '商品商家编码': '1892110878',
    '商品条形码': '',
    'SKU规格': '颜色:浅灰;尺码:S',
    'SKU划线价': '178',
    'SKU价格': '178',
    'SKU拼单价': '178',
    'SKU成本价': '230',
    'SKU库存': '1',
    'SKU重量': '',
    'SKU商家编码': '6941669851999',
    'SKU条形码': '',
    '商品主图': 'https://img.alicdn.com/imgextra/i1/554185355/O1CN011pQdONWFTuwRS4F_!!554185355.jpg,http://www.ipuhuo.com/zt02.jpg,http://www.ipuhuo.com/zt03.jpg,http://www.ipuhuo.com/zt04.jpg,http://www.ipuhuo.com/zt05.jpg',
    'SKU主规格图': 'http://www.ipuhuo.com/zt01.jpg,http://www.ipuhuo.com/zt02.jpg,http://www.ipuhuo.com/zt03.jpg,http://www.ipuhuo.com/zt04.jpg,http://www.ipuhuo.com/zt05.jpg',
    '商品详情': `<div><br/><table width="750" border="0"><tbody><tr class="firstRow"><td colspan="3"><a href="#" target="_blank"><img src="http://ipuhuo-img.com/JJZFR3/839be609-038a-4166-b38d-71eb9f629fd0.jpg" alt="" width="750" height="369"/></a></td></tr></tbody></table></div>`,
    '商品类目': '女装/女士精品>>半身裙>>半身裙',
    '商品分组': '女装>>2020春,风格>>时尚',
    '商品属性': '作者:佚名;出版社:电子工业出版社',
    '商品卖点': '',
    '透明素材图': '',
    '商品竖图': '',
    '商品长图': '',
    '主图视频': 'http://www.video.com/1.mp4'
  }
];

interface ProjectState {
  rows: CleanerRow[];
}

export default function App() {
  // --- Data Logic State ---
  const [project, setProject] = useState<ProjectState>(() => {
    const savedRows = localStorage.getItem('sku_gen_db');
    return {
      rows: savedRows ? JSON.parse(savedRows) : INITIAL_ROWS
    };
  });

  useEffect(() => {
    localStorage.setItem('sku_gen_db', JSON.stringify(project.rows));
  }, [project]);

  const handleAddRows = (newRows: CleanerRow[]) => {
    // New rows are always unverified by default
    const rowsWithStatus = newRows.map(r => ({ ...r, checkStatus: 'unverified' as const }));
    setProject(prev => ({ rows: [...prev.rows, ...rowsWithStatus] }));
  };

  const handleRemoveRows = (idsToRemove: (string | number)[]) => {
    const idSet = new Set(idsToRemove);
    setProject(prev => ({
      rows: prev.rows.filter(row => !idSet.has(row._internal_id!))
    }));
  };

  // Batch update status (e.g., mark as verified after AI check)
  const handleUpdateStatus = (ids: (string | number)[], status: 'verified' | 'unverified') => {
    const idSet = new Set(ids);
    setProject(prev => ({
      rows: prev.rows.map(row => {
        if (idSet.has(row._internal_id!)) {
          return { ...row, checkStatus: status };
        }
        return row;
      })
    }));
  };

  // Batch update generic fields (Used for Renaming)
  const handleBatchUpdate = (updates: { id: string | number; changes: Partial<CleanerRow> }[]) => {
    setProject(prev => {
      // Create a map for O(1) lookup
      const updateMap = new Map(updates.map(u => [u.id, u.changes]));
      
      const newRows = prev.rows.map(row => {
        if (updateMap.has(row._internal_id!)) {
          return { ...row, ...updateMap.get(row._internal_id!) };
        }
        return row;
      });
      return { ...prev, rows: newRows };
    });
  };

  const handleCellEdit = (rowId: number | string, column: string, value: any) => {
    setProject(prev => {
      // 1. Identify source row to find identifiers
      const sourceRow = prev.rows.find(r => r._internal_id === rowId);
      if (!sourceRow) return prev;

      const productCode = sourceRow['商品商家编码'];
      const skuCode = sourceRow['SKU商家编码'];

      // 2. Determine Scope (Product vs SKU)
      // Product Fields: Start with '商品', or are specific product-level dimensions/media
      const isProductScope = column.startsWith('商品') || 
                             ['长', '宽', '高', '主图视频', '透明素材图'].includes(column);

      const newRows = prev.rows.map(row => {
        let shouldUpdate = false;

        // Always update the target row
        if (row._internal_id === rowId) {
          shouldUpdate = true;
        } else {
          // Check for Sync Conditions
          if (isProductScope) {
            // Sync if Product Code matches and is not empty
            if (productCode && String(productCode).trim() !== '' && 
                String(row['商品商家编码']) === String(productCode)) {
              shouldUpdate = true;
            }
          } else {
            // Sync if SKU Code matches and is not empty
            // For SKU fields, we sync rows sharing the same SKU Code (duplicates)
            if (skuCode && String(skuCode).trim() !== '' && 
                String(row['SKU商家编码']) === String(skuCode)) {
               shouldUpdate = true;
            }
          }
        }

        if (shouldUpdate) {
          const updatedRow = { ...row, [column]: value };
          // If critical fields change, reset status to unverified
          if (column === '商品名称' || column === 'SKU规格') {
            updatedRow.checkStatus = 'unverified';
          }
          return updatedRow;
        }
        return row;
      });
      return { ...prev, rows: newRows };
    });
  };

  const handleImportData = (newRows: CleanerRow[]) => {
    if (newRows.length > 0) {
      // Imported rows are unverified
      const rowsWithStatus = newRows.map(r => ({ ...r, checkStatus: 'unverified' as const }));
      setProject(prev => ({ rows: [...prev.rows, ...rowsWithStatus] }));
    }
  };

  const resetDatabase = () => {
    // Directly clear state and storage. Confirmation is handled in the UI component now.
    setProject({ rows: [] });
    localStorage.setItem('sku_gen_db', JSON.stringify([]));
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F3F3F3] overflow-hidden font-segoe">
      {/* Windows 10 Title Bar Style Header */}
      <header className="h-[32px] bg-white border-b border-[#E5E5E5] flex items-center justify-between px-3 select-none app-region-drag">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-[#0078D7] flex items-center justify-center text-white text-[10px] font-bold">
            S
          </div>
          <span className="text-xs text-[#333333]">SKU 生成工具 Pro</span>
        </div>
        <div className="flex items-center gap-4 app-region-no-drag">
          <span className="text-[10px] text-[#999999]">Auto-saved to LocalStorage</span>
        </div>
      </header>

      {/* Main Content Layout */}
      <main className="flex-1 flex overflow-hidden">
        {/* Left Panel: Controls - Windows 10 Side Panel Style */}
        <aside className="w-[360px] bg-[#F2F2F2] border-r border-[#D9D9D9] flex flex-col z-10">
          <CleaningPanel 
            currentRows={project.rows}
            onAddRows={handleAddRows}
            onRemoveRows={handleRemoveRows}
            onUpdateStatus={handleUpdateStatus}
            onBatchUpdate={handleBatchUpdate}
            onClearAll={resetDatabase}
          />
        </aside>

        {/* Right Panel: Data Grid - Windows 10 Content Area */}
        <section className="flex-1 flex flex-col min-w-0 bg-white">
          <div className="flex-1 overflow-hidden flex flex-col">
            <DataGrid 
              data={project.rows}
              headers={HEADERS}
              onImportData={handleImportData}
              onCellEdit={handleCellEdit}
            />
          </div>
        </section>
      </main>
    </div>
  );
}
