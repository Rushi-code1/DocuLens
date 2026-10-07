import React, { useState } from 'react';
import { FileText, Plus, Trash2, File, ChevronDown, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

export default function Sidebar({
  documents,
  activeDoc,
  onSelectDoc,
  onDeleteDoc,
  onUploadClick,
  isOpen
}) {
  const [isDocsOpen, setIsDocsOpen] = useState(true);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  if (!isOpen) return null;

  return (
    <aside
      className={`${
        isSidebarCollapsed ? 'w-14' : 'w-52'
      } border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 flex flex-col h-full flex-shrink-0 transition-all duration-200 select-none`}
    >
      {/* Top Header / Upload & Collapse Controls */}
      <div className="p-2 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-1">
        {!isSidebarCollapsed ? (
          <>
            <button
              onClick={onUploadClick}
              className="flex-1 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-1.5 px-2.5 text-xs font-medium transition-all shadow-xs flex items-center justify-center space-x-1.5 min-w-0"
            >
              <Plus className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">Upload</span>
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(true)}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex-shrink-0"
              title="Collapse sidebar"
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </>
        ) : (
          <div className="w-full flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={() => setIsSidebarCollapsed(false)}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Expand sidebar"
            >
              <PanelLeftOpen className="w-4 h-4" />
            </button>
            <button
              onClick={onUploadClick}
              className="w-9 h-9 bg-blue-600 hover:bg-blue-500 text-white rounded-xl flex items-center justify-center transition-all shadow-xs"
              title="Upload Document"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Document List */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
        {!isSidebarCollapsed ? (
          <>
            {/* Collapsible Section Header */}
            <button
              type="button"
              onClick={() => setIsDocsOpen(!isDocsOpen)}
              className="w-full flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors text-left group"
            >
              <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
                Saved Documents ({documents.length})
              </span>
              <span className="text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-transform">
                {isDocsOpen ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5" />
                )}
              </span>
            </button>

            {/* Collapsible Content */}
            {isDocsOpen && (
              <div className="space-y-1 pt-0.5">
                {documents.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
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
                        className={`group flex items-center justify-between p-2 rounded-xl cursor-pointer text-xs transition-all ${
                          isSelected
                            ? 'bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200/90 dark:border-blue-900 text-blue-900 dark:text-blue-300 font-medium'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800/80 text-slate-700 dark:text-slate-300 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate min-w-0">
                          <FileText className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                          <div className="truncate">
                            <p className="truncate text-xs text-slate-800 dark:text-slate-200">{doc.filename}</p>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500">
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
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 text-slate-400 transition-opacity"
                          title="Delete Document"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </>
        ) : (
          /* Collapsed Mini Rail Icons */
          <div className="flex flex-col items-center gap-1.5 pt-1">
            {documents.map((doc) => {
              const isSelected = activeDoc?.id === doc.id;
              return (
                <button
                  key={doc.id}
                  onClick={() => onSelectDoc(doc)}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                    isSelected
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                  title={`${doc.filename} (${doc.word_count ? `${doc.word_count.toLocaleString()} words` : 'Document'})`}
                >
                  <FileText className="w-4 h-4" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
