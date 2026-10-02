import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { fetchDocuments, uploadDocument, fetchMessages, askQuestion, deleteDocument } from './api';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import PdfViewer from './components/PdfViewer';
import ChatWorkspace from './components/ChatWorkspace';
import AuthModal from './components/AuthModal';
import { UploadCloud, FileText, Sparkles, AlertCircle } from 'lucide-react';

export default function App() {
  const { user } = useAuth();
  const [theme, setTheme] = useState(localStorage.theme || 'light');
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [activeDoc, setActiveDoc] = useState(null);
  const [messages, setMessages] = useState([]);
  const [pinnedContext, setPinnedContext] = useState('');
  const [uploading, setUploading] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const fileInputRef = useRef(null);

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

  // Load documents whenever user is authenticated
  useEffect(() => {
    if (user) {
      loadDocs();
    } else {
      setDocuments([]);
      setActiveDoc(null);
      setMessages([]);
    }
  }, [user]);

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
      if (docs.length > 0 && !activeDoc) {
        setActiveDoc(docs[0]);
      }
    } catch (err) {
      console.warn('Could not fetch documents:', err.message);
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
    setErrorMsg('');
    try {
      const newDoc = await uploadDocument(file);
      setDocuments((prev) => [newDoc, ...prev]);
      setActiveDoc(newDoc);
    } catch (err) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
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

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#FAF9F5] dark:bg-slate-950 font-sans">
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
          onSelectDoc={(doc) => setActiveDoc(doc)}
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
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#FAF9F5] dark:bg-slate-950">
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
                className="max-w-md w-full border-2 border-dashed border-stone-300 dark:border-slate-800 hover:border-blue-500 rounded-3xl p-10 cursor-pointer bg-white/50 dark:bg-slate-900/40 hover:bg-blue-50/20 dark:hover:bg-blue-950/20 transition-all flex flex-col items-center shadow-xs"
              >
                <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center mb-4 shadow-2xs">
                  {uploading ? (
                    <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                  ) : (
                    <UploadCloud className="w-7 h-7" />
                  )}
                </div>

                <h3 className="text-base font-semibold text-stone-900 dark:text-white mb-1">
                  {uploading ? 'Analyzing Document with Gemini...' : 'Drop your document here'}
                </h3>
                <p className="text-xs text-stone-500 dark:text-slate-400 mb-4">
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

      {/* Auth Modal */}
      <AuthModal isOpen={isAuthOpen} onClose={() => setIsAuthOpen(false)} />
    </div>
  );
}
