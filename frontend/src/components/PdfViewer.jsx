import React, { useEffect, useRef, useState } from 'react';
import { Eye, BookOpen, Search, Sparkles, Pin } from 'lucide-react';
import { fetchDocumentBinary } from '../api';

// Configure Web Worker location at module evaluation time
if (typeof window !== 'undefined' && window.pdfjsLib) {
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

// In-memory session cache for parsed PDF document proxies
const docPdfCache = new Map();

export default function PdfViewer({
  document: docItem,
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

  const isPdf =
    docItem?.filename?.toLowerCase().endsWith('.pdf') ||
    docItem?.file?.toLowerCase().endsWith('.pdf');

  useEffect(() => {
    if (!isPdf || !docItem?.file_url) {
      setViewMode('text');
      return;
    }

    let isMounted = true;
    let observer = null;
    const activeRenderTasks = new Map();

    setViewMode('pdf');
    renderPdf();

    async function renderPdf() {
      if (typeof window.pdfjsLib === 'undefined' || !pagesContainerRef.current) return;
      setLoadingPdf(true);
      pagesContainerRef.current.innerHTML = '';

      try {
        if (!window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        const PDF_BASE_CONFIG = {
          cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/',
          enableXfa: false,
          disableFontFace: false // Enables browser @font-face engine for native font hinting and razor-sharp text
        };

        let pdf;
        if (docItem.id && docPdfCache.has(docItem.id)) {
          pdf = docPdfCache.get(docItem.id);
        } else {
          let pdfSource;
          if (docItem._localFile) {
            const arrayBuffer = await docItem._localFile.arrayBuffer();
            pdfSource = {
              data: arrayBuffer,
              ...PDF_BASE_CONFIG
            };
          } else {
            // Enable HTTP range streaming for instant first-page delivery
            pdfSource = {
              url: docItem.file_url,
              rangeChunkSize: 65536,
              disableRange: false,
              disableStream: false,
              ...PDF_BASE_CONFIG
            };
          }

          try {
            const loadingTask = window.pdfjsLib.getDocument(pdfSource);
            pdf = await loadingTask.promise;
          } catch (streamErr) {
            // Fallback to direct array buffer retrieval if range streaming fails
            console.warn('Direct stream error, attempting binary fallback:', streamErr);
            const arrayBuffer = await fetchDocumentBinary(docItem.id);
            const fallbackTask = window.pdfjsLib.getDocument({
              data: arrayBuffer,
              ...PDF_BASE_CONFIG
            });
            pdf = await fallbackTask.promise;
          }

          if (docItem.id) {
            docPdfCache.set(docItem.id, pdf);
          }
        }

        if (!isMounted) return;
        setLoadingPdf(false);

        const containerWidth = containerRef.current?.clientWidth || 800;
        const dpr = window.devicePixelRatio || 1;
        // Supersample canvas resolution to at least 2.0x (up to 2.5x on high-DPI screens) for crystal-clear, Retina-quality text
        const outputScale = Math.min(Math.max(dpr, 2.0), 2.5);

        // Calculate layout geometry from page 1 immediately
        const page1 = await pdf.getPage(1);
        const unscaled1 = page1.getViewport({ scale: 1.0 });
        const targetWidth = Math.min(containerWidth - 64, 820);
        const scale = Math.max(1.0, targetWidth / unscaled1.width);
        const defaultViewport = page1.getViewport({ scale });
        const estimatedWidth = Math.floor(defaultViewport.width);
        const estimatedHeight = Math.floor(defaultViewport.height);

        // Mount Page 1 wrapper immediately
        const page1Wrapper = document.createElement('div');
        page1Wrapper.className = 'pdf-page-wrapper';
        page1Wrapper.style.position = 'relative';
        page1Wrapper.style.overflow = 'hidden';
        page1Wrapper.style.width = `${estimatedWidth}px`;
        page1Wrapper.style.minHeight = `${estimatedHeight}px`;
        page1Wrapper.setAttribute('data-page-number', '1');
        pagesContainerRef.current.appendChild(page1Wrapper);

        const renderedPages = new Set([1]);
        const pageWrappers = [page1Wrapper];

        async function renderSinglePage(page, pageNum, wrapper) {
          if (!isMounted || wrapper.hasAttribute('data-rendered')) return;
          wrapper.setAttribute('data-rendered', 'true');

          const vp = page.getViewport({ scale });
          wrapper.style.width = `${Math.floor(vp.width)}px`;
          wrapper.style.height = `${Math.floor(vp.height)}px`;

          // Hardware-accelerated canvas context
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d', { alpha: false });
          canvas.width = Math.floor(vp.width * outputScale);
          canvas.height = Math.floor(vp.height * outputScale);
          canvas.style.width = `${Math.floor(vp.width)}px`;
          canvas.style.height = `${Math.floor(vp.height)}px`;

          context.imageSmoothingEnabled = true;
          context.imageSmoothingQuality = 'high';

          const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
          const renderContext = {
            canvasContext: context,
            transform: transform,
            viewport: vp,
            intent: 'display'
          };

          const textLayerDiv = document.createElement('div');
          textLayerDiv.className = 'textLayer';
          textLayerDiv.style.position = 'absolute';
          textLayerDiv.style.left = '0';
          textLayerDiv.style.top = '0';
          textLayerDiv.style.width = `${Math.floor(vp.width)}px`;
          textLayerDiv.style.height = `${Math.floor(vp.height)}px`;
          textLayerDiv.style.setProperty('--scale-factor', vp.scale);

          wrapper.appendChild(canvas);
          wrapper.appendChild(textLayerDiv);

          // Rasterize canvas
          const renderTask = page.render(renderContext);
          activeRenderTasks.set(pageNum, renderTask);

          const canvasPromise = renderTask.promise.catch((err) => {
            if (err?.name !== 'RenderingCancelledException') throw err;
          });

          // Concurrent text layer extraction
          const textPromise = page
            .getTextContent()
            .then((textContent) => {
              if (!isMounted) return null;
              if (window.pdfjsLib.TextLayer) {
                const textLayer = new window.pdfjsLib.TextLayer({
                  textContentSource: textContent,
                  container: textLayerDiv,
                  viewport: vp
                });
                return textLayer.render();
              } else if (window.pdfjsLib.renderTextLayer) {
                return window.pdfjsLib.renderTextLayer({
                  textContentSource: textContent,
                  container: textLayerDiv,
                  viewport: vp,
                  textDivs: []
                }).promise;
              }
            })
            .catch(console.warn);

          try {
            await Promise.all([canvasPromise, textPromise]);
          } finally {
            activeRenderTasks.delete(pageNum);
          }
        }

        // Render Page 1 first to display content instantly
        renderSinglePage(page1, 1, page1Wrapper);

        // Defer creation of remaining page skeletons to keep the main thread fluid
        setTimeout(() => {
          if (!isMounted || !pagesContainerRef.current) return;

          for (let pageNum = 2; pageNum <= pdf.numPages; pageNum++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'pdf-page-wrapper';
            wrapper.style.position = 'relative';
            wrapper.style.overflow = 'hidden';
            wrapper.style.width = `${estimatedWidth}px`;
            wrapper.style.minHeight = `${estimatedHeight}px`;
            wrapper.setAttribute('data-page-number', pageNum);
            pagesContainerRef.current.appendChild(wrapper);
            pageWrappers.push(wrapper);

            if (observer) {
              observer.observe(wrapper);
            }
          }
        }, 0);

        // IntersectionObserver for remaining pages
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) {
                const wrapper = entry.target;
                const pNum = parseInt(wrapper.getAttribute('data-page-number'), 10);
                if (!renderedPages.has(pNum)) {
                  renderedPages.add(pNum);
                  pdf
                    .getPage(pNum)
                    .then((p) => {
                      renderSinglePage(p, pNum, wrapper);
                    })
                    .catch(console.warn);
                }
              }
            });
          },
          {
            root: containerRef.current,
            rootMargin: '450px 0px'
          }
        );

        observer.observe(page1Wrapper);
      } catch (err) {
        console.error('PDF.js render error:', err);
      } finally {
        if (isMounted) setLoadingPdf(false);
      }
    }

    // Effect cleanup
    return () => {
      isMounted = false;
      if (observer) {
        observer.disconnect();
      }
      activeRenderTasks.forEach((task) => {
        try {
          task.cancel();
        } catch (_) {}
      });
      activeRenderTasks.clear();
    };
  }, [docItem?.id, docItem?.file_url, isPdf]);

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
            const left = Math.max(
              16,
              Math.min(window.innerWidth - 220, rect.left + rect.width / 2 - 90)
            );
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
    if (!docItem?.full_text) return '';
    if (!searchQuery.trim()) return docItem.full_text;

    const regex = new RegExp(`(${searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return docItem.full_text.split(regex).map((part, i) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <mark
          key={i}
          className="bg-amber-200 dark:bg-amber-400 dark:text-slate-900 text-slate-900 px-0.5 rounded font-medium"
        >
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 dark:bg-slate-900 transition-colors">
      {/* Viewer Toolbar */}
      <div className="h-12 px-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between flex-shrink-0 bg-white dark:bg-slate-900">
        <div className="flex items-center space-x-2">
          {isPdf && (
            <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setViewMode('pdf')}
                className={`flex items-center space-x-1 px-2.5 py-1 rounded-md transition-all ${
                  viewMode === 'pdf'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
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
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 font-semibold shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>Text Reader</span>
              </button>
            </div>
          )}

          <span className="text-[11px] text-slate-400 dark:text-slate-500">
            {docItem?.word_count ? `${docItem.word_count.toLocaleString()} words` : ''}
          </span>
        </div>

        {/* Find in Document */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (e.target.value) setViewMode('text');
            }}
            placeholder="Find in document..."
            className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg pl-8 pr-3 py-1 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-500 w-44 placeholder-slate-400"
          />
        </div>
      </div>

      {/* Viewer Main Body */}
      <div ref={containerRef} className="flex-1 overflow-y-auto relative">
        {loadingPdf && viewMode === 'pdf' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/90 dark:bg-slate-900/90 backdrop-blur-xs text-slate-500 dark:text-slate-400 text-xs">
            <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-3"></div>
            <p className="font-medium text-slate-700 dark:text-slate-200">Loading document...</p>
          </div>
        )}

        {/* PDF.js Canvas & TextLayer Container */}
        <div
          ref={pagesContainerRef}
          className={`${viewMode === 'pdf' ? 'flex' : 'hidden'} flex-col items-center p-4 bg-slate-100/70 dark:bg-slate-950 min-h-full`}
        >
          {/* Rendered pages inserted here */}
        </div>

        {/* Plain Text Reader Mode */}
        {viewMode === 'text' && (
          <div className="p-8 max-w-3xl mx-auto doc-content text-slate-900 dark:text-slate-200 text-[14.5px] leading-relaxed whitespace-pre-wrap">
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
          className="fixed z-50 bg-slate-900 text-white rounded-xl shadow-2xl px-2.5 py-1.5 flex items-center space-x-2 border border-slate-700 dark:border-slate-700 text-xs select-none"
        >
          <button
            type="button"
            onClick={() => {
              onAskSection(selection);
              setSelection(null);
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-slate-800 text-blue-400 hover:text-blue-300 font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Ask AI</span>
          </button>
          <div className="h-3 w-px bg-slate-700"></div>
          <button
            type="button"
            onClick={() => {
              onPinContext(selection);
              setSelection(null);
            }}
            className="flex items-center space-x-1 px-2.5 py-1 rounded-lg hover:bg-slate-800 text-amber-300 hover:text-amber-200 font-medium transition-colors"
          >
            <Pin className="w-3.5 h-3.5" />
            <span>Set as Context</span>
          </button>
        </div>
      )}
    </div>
  );
}