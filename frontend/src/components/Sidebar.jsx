import React from 'react';
import { FileText, Plus, Trash2, Calendar, File, CheckCircle2 } from 'lucide-react';

export default function Sidebar({
  documents,
  activeDoc,
  onSelectDoc,
  onDeleteDoc,
  onUploadClick,
  isOpen
}) {
  if (!isOpen) return null;

  return (
    <aside className="w-64 border-r border-[#E7E5E0] dark:border-slate-800 bg-[#F5F4F0] dark:bg-slate-900/60 flex flex-col h-full flex-shrink-0 transition-all">
      {/* Upload Action */}
      <div className="p-3.5 border-b border-[#E7E5E0] dark:border-slate-800">
        <button
          onClick={onUploadClick}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2 px-3 text-xs font-medium transition-all shadow-xs flex items-center justify-center space-x-1.5"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Upload Document</span>
        </button>
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1.5 text-[10px] font-semibold text-stone-400 dark:text-slate-500 uppercase tracking-wider">
          Saved Documents ({documents.length})
        </div>

        {documents.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-stone-400 dark:text-slate-500">
            <File className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
            <p className="text-[11px]">No documents yet</p>
          </div>
        ) : (
          documents.map((doc) => {
            const isSelected = activeDoc?.id === doc.id;
            return (
              <div
                key={doc.id}
                onClick={() => onSelectDoc(doc)}
                className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer text-xs transition-all ${
                  isSelected
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-900 text-blue-900 dark:text-blue-300 font-medium'
                    : 'hover:bg-[#EFECE6] dark:hover:bg-slate-800/80 text-stone-700 dark:text-slate-300 border border-transparent'
                }`}
              >
                <div className="flex items-center space-x-2 truncate min-w-0">
                  <FileText className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-stone-400'}`} />
                  <div className="truncate">
                    <p className="truncate text-xs">{doc.filename}</p>
                    <p className="text-[10px] text-stone-400 dark:text-slate-500">
                      {doc.word_count ? `${doc.word_count.toLocaleString()} words` : 'Document'}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`Delete "${doc.filename}"?`)) {
                      onDeleteDoc(doc.id);
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 text-stone-400 transition-opacity"
                  title="Delete Document"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
