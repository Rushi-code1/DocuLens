import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { fetchDocuments, uploadDocument, fetchMessages, askQuestion, deleteDocument } from './api';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import PdfViewer from './components/PdfViewer';
import ChatWorkspace from './components/ChatWorkspace';
import AuthModal from './components/AuthModal';
import { UploadCloud, FileText, Sparkles, AlertCircle, CheckCircle2 } from 'lucide-react';
import docsleansIcon from './assets/docsleans-icon.png';

export default function App() {
  const { user, loading } = useAuth();
  const [theme, setTheme] = useState(localStorage.theme || 'light');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pinnedContext, setPinnedContext] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingDocName, setUploadingDocName] = useState('');
  const [uploadStage, setUploadStage] = useState(0);
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef(null);

  // Animate processing stages while uploading
  useEffect(() => {
    if (!uploading) {
      setUploadStage(0);
      return;
    }
    const timer1 = setTimeout(() => setUploadStage(1), 1800);
    const timer2 = setTimeout(() => setUploadStage(2), 3800);
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [uploading]);

  // Toggle Theme
  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    localStorage.theme = nextTheme;
    if (nextTheme === 'dark') {
      window.document.documentElement.classList.add('dark');
    } else {
      window.document.documentElement.classList.remove('dark');
    }
  };

  const [initialLoading, setInitialLoading] = useState(true);

  // Synchronized initial workspace loading: prevents intermediate flash
  useEffect(() => {
    if (loading) return; // Wait until AuthContext finishes checking token

    if (!user) {
      setDocuments([]);
      setActiveDoc(null);
      setMessages([]);
      setInitialLoading(false);
      return;
    }

    let isMounted = true;
    async function initUserWorkspace() {
      try {
        const docs = await fetchDocuments();
        if (!isMounted) return;
        setDocuments(docs);
        if (docs.length > 0) {
          const savedId = localStorage.getItem('doculens_active_doc_id');
          const found = savedId ? docs.find((d) => String(d.id) === String(savedId)) : null;
          setActiveDoc(found || docs[0]);
        }
      } catch (err) {
        console.warn('Could not fetch documents:', err.message);
      } finally {
        if (isMounted) {
          setInitialLoading(false);
        }
      }
    }

    initUserWorkspace();

    return () => {
      isMounted = false;
    };
  }, [user, loading]);

  // Load chat messages when active document changes
  useEffect(() => {
    if (activeDoc) {
      loadChat(activeDoc.id);
    } else {
      setMessages([]);
    }
  }, [activeDoc?.id]);

  const loadDocs = async () => {
    try {
      const docs = await fetchDocuments();
      setDocuments(docs);
      if (docs.length > 0) {
        const savedId = localStorage.getItem('doculens_active_doc_id');
        const found = savedId ? docs.find((d) => String(d.id) === String(savedId)) : null;
        setActiveDoc(found || docs[0]);
      }
    } catch (err) {
      console.warn('Could not fetch documents:', err.message);
    }
  };

  const handleSelectDoc = (doc) => {
    setActiveDoc(doc);
    if (doc?.id) {
      localStorage.setItem('doculens_active_doc_id', doc.id);
    }
  };

  const loadChat = async (docId) => {
    try {
      const msgs = await fetchMessages(docId);
      setMessages(msgs);
    } catch (err) {
      console.warn('Could not fetch messages:', err.message);
    }
  };

  const handleFileUpload = async (file) => {
    if (!user) {
      setIsAuthOpen(true);
      return;
    }

    setUploading(true);
    setUploadingDocName(file.name || 'document');
    setUploadStage(0);
    setErrorMsg('');
    try {
      const newDoc = await uploadDocument(file);
      // Attach local file to load instantly from RAM without waiting to re-download over HTTP
      newDoc._localFile = file;
      setDocuments((prev) => [newDoc, ...prev]);
      handleSelectDoc(newDoc);
    } catch (err) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadingDocName('');
    }
  };

  const handleDeleteDoc = async (docId) => {
    try {
      await deleteDocument(docId);
      const remaining = documents.filter((d) => d.id !== docId);
      setDocuments(remaining);
      if (activeDoc?.id === docId) {
        setActiveDoc(remaining.length > 0 ? remaining[0] : null);
      }
    } catch (err) {
      alert('Could not delete document: ' + err.message);
    }
  };

  const handleSendMessage = async (question) => {
    if (!activeDoc) return;
    setChatLoading(true);

    // Optimistically append user message
    const tempUserMsg = {
      id: Date.now(),
      sender: 'user',
      content: question,
      selected_context: pinnedContext
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    const contextToSend = pinnedContext;
    setPinnedContext('');

    try {
      const res = await askQuestion(activeDoc.id, question, contextToSend);
      // Append bot response
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        res.user_message,
        res.assistant_message
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: 'assistant',
          content: `⚠️ Failed to get answer: ${err.message}`
        }
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  if (initialLoading) {
    return (
      <div className="flex flex-col h-screen w-screen items-center justify-center bg-slate-50 dark:bg-slate-950 font-sans transition-colors">
        <div className="flex flex-col items-center space-y-4">
          <div className="relative flex items-center justify-center">
            <img
              src={docsleansIcon}
              alt="docsLeans"
              className="w-14 h-14 rounded-2xl shadow-lg shadow-blue-500/20 object-contain animate-pulse"
            />
            <div className="absolute -inset-2 border-2 border-blue-500/20 border-t-blue-600 rounded-3xl animate-spin"></div>
          </div>
          <div className="flex flex-col items-center">
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">docsLeans</h1>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Restoring workspace session...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-slate-50 dark:bg-slate-950 font-sans">
      <Navbar
        activeDoc={activeDoc}
        theme={theme}
        toggleTheme={toggleTheme}
        onOpenAuth={() => setIsAuthOpen(true)}
        onUploadClick={() => fileInputRef.current?.click()}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.txt,.md"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            handleFileUpload(e.target.files[0]);
          }
        }}
      />

      {/* Main Workspace Grid */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          isOpen={!!user}
          documents={documents}
          activeDoc={activeDoc}
          onSelectDoc={handleSelectDoc}
          onDeleteDoc={handleDeleteDoc}
          onUploadClick={() => fileInputRef.current?.click()}
        />

        {/* Center Panel: Document or Upload Hero */}
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
          {errorMsg && (
            <div className="m-4 p-3 bg-red-100 dark:bg-red-950 border border-red-300 dark:border-red-800 rounded-xl text-xs text-red-800 dark:text-red-200 flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeDoc ? (
            <PdfViewer
              document={activeDoc}
              onPinContext={(text) => setPinnedContext(text)}
              onAskSection={(text) => {
                setPinnedContext(text);
                handleSendMessage(`Explain this section in detail: "${text}"`);
              }}
            />
          ) : (
            /* Upload Hero Screen */
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-slate-50 dark:bg-slate-950">
              <div
                onClick={() => {
                  if (!user) {
                    setIsAuthOpen(true);
                  } else {
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) {
                    handleFileUpload(e.dataTransfer.files[0]);
                  }
                }}
                className="max-w-md w-full border-2 border-dashed border-slate-300 dark:border-slate-800 hover:border-blue-500 rounded-3xl p-10 cursor-pointer bg-white/70 dark:bg-slate-900/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 transition-all flex flex-col items-center shadow-xs"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 shadow-2xs">
                  {uploading ? (
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <UploadCloud className="w-7 h-7" />
                  )}
                </div>

                <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
                  {uploading ? 'Analyzing Document with Gemini...' : 'Drop your document here'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  Upload PDF, Markdown, or Text. Generates an instant executive brief and interactive reader.
                </p>

                <button
                  type="button"
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl text-xs font-medium shadow-xs transition-all"
                >
                  {user ? 'Browse Files' : 'Sign In to Upload'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Panel: Chat Assistant */}
        {activeDoc && (
          <ChatWorkspace
            document={activeDoc}
            messages={messages}
            pinnedContext={pinnedContext}
            onClearPinnedContext={() => setPinnedContext('')}
            onSendMessage={handleSendMessage}
            loading={chatLoading}
          />
        )}
      </div>

      {/* Upload & AI Processing Modal Animation */}
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-7 max-w-sm w-full mx-4 shadow-2xl flex flex-col items-center text-center relative overflow-hidden">
            {/* Top gradient highlight bar */}
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-blue-500 via-indigo-500 to-sky-400 animate-pulse"></div>

            {/* Glowing & bouncing logo animation */}
            <div className="relative my-4 flex items-center justify-center">
              <span className="absolute inline-flex h-20 w-20 rounded-2xl bg-blue-500/20 animate-ping"></span>
              <div className="relative w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 shadow-md flex items-center justify-center p-2.5 border border-blue-100 dark:border-blue-900/50">
                <img
                  src={docsleansIcon}
                  alt="docsLeans"
                  className="w-full h-full object-contain animate-bounce"
                />
              </div>
            </div>

            <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
              Processing Document
            </h3>
            {uploadingDocName && (
              <p className="text-xs font-medium text-blue-600 dark:text-blue-400 truncate max-w-[260px] mt-0.5" title={uploadingDocName}>
                {uploadingDocName}
              </p>
            )}

            {/* Animated multi-stage progress indicator */}
            <div className="w-full mt-5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3 border border-slate-200/80 dark:border-slate-700/60 text-left space-y-2.5 text-xs">
              {/* Step 1 */}
              <div className="flex items-center space-x-2.5">
                {uploadStage > 0 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin flex-shrink-0"></div>
                )}
                <span className={uploadStage === 0 ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}>
                  Extracting text & parsing pages
                </span>
              </div>

              {/* Step 2 */}
              <div className="flex items-center space-x-2.5">
                {uploadStage > 1 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                ) : uploadStage === 1 ? (
                  <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin flex-shrink-0"></div>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 ml-1 mr-1 flex-shrink-0"></div>
                )}
                <span className={uploadStage === 1 ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}>
                  Vectorizing embeddings with ChromaDB
                </span>
              </div>

              {/* Step 3 */}
              <div className="flex items-center space-x-2.5">
                {uploadStage === 2 ? (
                  <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin flex-shrink-0"></div>
                ) : (
                  <div className="w-2 h-2 rounded-full bg-slate-300 dark:bg-slate-600 ml-1 mr-1 flex-shrink-0"></div>
                )}
                <span className={uploadStage === 2 ? "font-semibold text-slate-800 dark:text-slate-200" : "text-slate-500 dark:text-slate-400"}>
                  Gemini synthesizing summary & topics
                </span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-4">
              Please wait while docsLeans prepares your document...
            </p>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </div>
  );
}
