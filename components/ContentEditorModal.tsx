import React, { useState, useEffect } from 'react';

interface ContentEditorModalProps {
  isOpen: boolean;
  title: string;
  initialValue: string;
  type: 'html' | 'images';
  onClose: () => void;
  onSave: (newValue: string) => void;
}

export const ContentEditorModal: React.FC<ContentEditorModalProps> = ({
  isOpen,
  title,
  initialValue,
  type,
  onClose,
  onSave,
}) => {
  const [value, setValue] = useState(initialValue);

  // Sync state when opening with new value
  useEffect(() => {
    if (isOpen) {
      setValue(initialValue || '');
    }
  }, [isOpen, initialValue]);

  if (!isOpen) return null;

  // Parse images for preview
  const previewImages = type === 'images' 
    ? value.split(',').map(s => s.trim()).filter(s => s.length > 0)
    : [];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      {/* Window Container */}
      <div className="bg-white w-[90vw] h-[85vh] flex flex-col shadow-2xl border border-[#999999] animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="h-[40px] bg-white border-b border-[#E5E5E5] flex items-center justify-between px-4 select-none">
          <span className="font-semibold text-sm text-[#333333]">{title} - 编辑与预览</span>
          <button 
            onClick={onClose}
            className="text-[#666666] hover:text-red-600 transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body (Split View) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Editor */}
          <div className="w-1/2 flex flex-col border-r border-[#E5E5E5]">
            <div className="bg-[#F9F9F9] px-3 py-1 text-[10px] text-[#666666] border-b border-[#E5E5E5] uppercase tracking-wider">
              源代码 / 链接列表 (可编辑)
            </div>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="flex-1 w-full p-4 text-xs font-mono resize-none focus:outline-none focus:ring-inset focus:ring-2 focus:ring-[#0078D7]/20 leading-relaxed text-[#333333]"
              placeholder={type === 'images' ? "请输入图片链接，多个链接用英文逗号分隔..." : "请输入 HTML 代码..."}
              spellCheck={false}
            />
          </div>

          {/* Right: Preview */}
          <div className="w-1/2 flex flex-col bg-[#F3F3F3]">
            <div className="bg-[#EBEBEB] px-3 py-1 text-[10px] text-[#666666] border-b border-[#D9D9D9] uppercase tracking-wider">
              实时预览
            </div>
            <div className="flex-1 overflow-auto p-4">
              
              {/* HTML Preview */}
              {type === 'html' && (
                <div 
                  className="prose prose-sm max-w-none bg-white p-4 shadow-sm min-h-full border border-gray-200"
                  dangerouslySetInnerHTML={{ __html: value }} 
                />
              )}

              {/* Image Preview */}
              {type === 'images' && (
                <div className="grid grid-cols-2 gap-4">
                  {previewImages.length > 0 ? (
                    previewImages.map((src, idx) => (
                      <div key={idx} className="group relative bg-white border border-gray-200 p-2 shadow-sm hover:shadow-md transition-shadow">
                        <div className="aspect-square w-full relative overflow-hidden bg-gray-100 mb-2 flex items-center justify-center">
                          <img 
                            src={src} 
                            alt={`Preview ${idx}`} 
                            className="max-w-full max-h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = "https://placehold.co/400x400?text=Load+Failed";
                            }}
                          />
                        </div>
                        <div className="text-[10px] text-gray-500 break-all h-8 overflow-hidden leading-tight">
                          {idx + 1}. {src}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="col-span-2 text-center text-gray-400 py-10 text-xs">
                      暂无有效图片链接
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="h-[48px] bg-[#F3F3F3] border-t border-[#E5E5E5] flex items-center justify-end px-4 gap-3">
          <div className="mr-auto text-xs text-[#666666]">
            {type === 'images' ? `共检测到 ${previewImages.length} 张图片` : `HTML 字符数: ${value.length}`}
          </div>
          <button 
            onClick={onClose}
            className="px-6 py-1.5 text-xs bg-white border border-[#CCCCCC] hover:bg-[#E5E5E5] text-[#333333] transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => onSave(value)}
            className="px-6 py-1.5 text-xs bg-[#0078D7] border border-[#0078D7] hover:bg-[#006CC1] text-white shadow-sm transition-colors"
          >
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
};
