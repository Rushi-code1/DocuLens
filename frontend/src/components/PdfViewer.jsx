import React, { useEffect, useRef, useState } from 'react';
import { Eye, BookOpen, Search, Sparkles, Pin } from 'lucide-react';

export default function PdfViewer({
  document,
  onPinContext,
  onAskSection
}) {
  const [viewMode, setViewMode] = useState('pdf');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingPdf, setLoadingPdf] = useState(false);
  const [selection, setSelection] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const containerRef = useRef(null);
  const pagesContainerRef = useRef(null);
  const popoverRef = useRef(null);

  const isPdf = document?.filename?.toLowerCase().endsWith('.pdf') || document?.file?.toLowerCase().endsWith('.pdf');

  useEffect(() => {
    if (!isPdf || !document?.file_url) {
      setViewMode('text');
      return;
    }

    let isMounted = true;
    setViewMode('pdf');
    renderPdf();

    async function renderPdf() {
      if (typeof window.pdfjsLib === 'undefined' || !pagesContainerRef.current) return;
      setLoadingPdf(true);
      pagesContainerRef.current.innerHTML = '';

      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const loadingTask = window.pdfjsLib.getDocument({ url: document.file_url });
        const pdf = await loadingTask.promise;

        if (!isMounted) return;

        const containerWidth = containerRef.current?.clientWidth || 800;

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (!isMounted) break;
          const page = await pdf.getPage(pageNum);

          const unscaledViewport = page.getViewport({ scale: 1.0 });
          const targetWidth = Math.min(containerWidth - 64, 820);
          const scale = Math.max(1.0, targetWidth / unscaledViewport.width);
          const viewport = page.getViewport({ scale });

          const pageWrapper = document.createElement('div');
          pageWrapper.className = 'pdf-page-wrapper';
          pageWrapper.style.width = `${Math.floor(viewport.width)}px`;
          pageWrapper.style.height = `${Math.floor(viewport.height)}px`;
          pageWrapper.setAttribute('data-page-number', pageNum);

          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const outputScale = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * outputScale);
          canvas.height = Math.floor(viewport.height * outputScale);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;

          const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

          const renderContext = {
            canvasContext: context,
            transform: transform,
            viewport: viewport
          };

          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';
          textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
          textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
          textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

          pageWrapper.appendChild(canvas);
          pageWrapper.appendChild(textLayerDiv);
          pagesContainerRef.current.appendChild(pageWrapper);

          await page.render(renderContext).promise;

          const textContent = await page.getTextContent();
          const textTask = window.pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
          });
          if (textTask && textTask.promise) {
            await textTask.promise;
          }
        }
      } catch (err) {
        console.error('PDF.js render error:', err);
      } finally {
        if (isMounted) setLoadingPdf(false);
      }
    }

    return () => {
      isMounted = false;
    };
  }, [document?.id, document?.file_url]);

  // Handle Text Selection inside PDF and Text Reader
  useEffect(() => {
    function handleMouseUp() {
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
          setSelection(null);
          return;
        }

        const text = sel.toString().trim();
        if (text.length < 3) {
          setSelection(null);
          return;
        }

        const range = sel.getRangeAt(0);
        const isInsidePdf = pagesContainerRef.current?.contains(range.commonAncestorContainer);
        const isInsideText = containerRef.current?.contains(range.commonAncestorContainer);

        if (isInsidePdf || isInsideText) {
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const left = Math.max(16, Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 90));
            let top = rect.top - 46;
            if (top < 10) top = rect.bottom + 8;

            setPopoverPos({ top, left });
            setSelection(text);
          }
        } else {
          setSelection(null);
        }
      }, 20);
    }

    function handleMouseDown(e) {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setSelection(null);
      }
    }

    window.document.addEventListener('mouseup', handleMouseUp);
    window.document.addEventListener('mousedown', handleMouseDown);
    return () => {
      window.document.removeEventListener('mouseup', handleMouseUp);
      window.document.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  const highlightedText = () => {
    if (!document?.full_text) return '';
    if (!searchQuery.trim()) return document.full_text;

    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return document.full_text.split(regex).map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark key={i} className="bg-amber-200 dark:bg-amber-400 dark:text-slate-900 text-stone-900 px-0.5 rounded font-medium">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#FAF9F5] dark:bg-slate-900 transition-colors">
      {/* Viewer Toolbar */}
      <div className="h-12 px-4 border-b border-[#E7E5E0] dark:border-slate-800 flex items-center justify-between flex-shrink-0 bg-[#FAF9F5] dark:bg-slate-900">
        <div className="flex items-center space-x-2">
          {isPdf && (
            <div className="flex items-center p-0.5 rounded-lg bg-[#EFECE6] dark:bg-slate-800 border border-[#D6D3CD] dark:border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'pdf'
                    ? 'bg-[#FAF9F5] dark:bg-slate-900 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                <span>PDF View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('text')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'text'
                    ? 'bg-[#FAF9F5] dark:bg-slate-900 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-stone-600 dark:text-slate-400 hover:text-stone-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Text Reader</span>
              </button>
            </div>
          )}

          <span className="text-[11px] text-stone-400 dark:text-slate-500">
            {document?.word_count ? `${document.word_count.toLocaleString()} words` : ''}
          </span>
        </div>

        {/* Find in Document */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-stone-400 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) setViewMode('text');
            }}
            placeholder="Find in document..."
            className="bg-[#EFECE6] dark:bg-slate-800 border border-[#D6D3CD] dark:border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-stone-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 w-44 placeholder-stone-400"
          />
        </div>
      </div>

      {/* Viewer Main Body */}
      <div ref={containerRef} className="flex-1 overflow-y-auto relative">
        {loadingPdf && viewMode === 'pdf' && (
          <div className="py-16 flex flex-col items-center justify-center text-stone-500 dark:text-slate-400 text-xs">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="font-medium">Rendering PDF pages...</p>
          </div>
        )}

        {/* PDF.js Canvas & TextLayer Container */}
        <div
          ref={pagesContainerRef}
          className={`${viewMode === 'pdf' ? 'flex' : 'hidden'} flex-col items-center p-4 bg-stone-200/50 dark:bg-slate-950 min-h-full`}
        >
          {/* Rendered pages inserted here */}
        </div>

        {/* Plain Text Reader Mode */}
        {viewMode === 'text' && (
          <div className="p-8 max-w-3xl mx-auto doc-content text-[#292524] dark:text-slate-200 text-[14.5px] leading-relaxed whitespace-pre-wrap">
            {highlightedText()}
          </div>
        )}
      </div>

      {/* Floating Selection Popover */}
      {selection && (
        <div
          ref={popoverRef}
          style={{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }}
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-50 bg-[#292524] dark:bg-slate-800 text-white rounded-xl shadow-2xl px-2.5 py-1.5 flex items-center space-x-2 border border-stone-600 dark:border-slate-700 text-xs select-none"
        >
          <button
            type="button"
            onClick={() => {
              onAskSection(selection);
              setSelection(null);
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-stone-800 text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ask AI</span>
          </button>
          <div className="h-3 w-px bg-stone-600"></div>
          <button
            type="button"
            onClick={() => {
              onPinContext(selection);
              setSelection(null);
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-stone-800 text-amber-300 hover:text-amber-200 font-medium transition-colors"
          >
            <Pin className="w-3.5 h-3.5" />
            <span>Set as Context</span>
          </button>
        </div>
      )}
    </div>
  );
}
