import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, ArrowUp, Pin, X, Trash2 } from 'lucide-react';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true
});

export default function ChatWorkspace({
  document,
  messages,
  pinnedContext,
  onClearPinnedContext,
  onSendMessage,
  loading
}) {
  const [question, setQuestion] = useState('');
  const feedEndRef = useRef(null);

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!question.trim() || loading) return;
    onSendMessage(question.trim());
    setQuestion('');
  };

  const renderMarkdown = (content) => {
    try {
      return { __html: marked.parse(content || '') };
    } catch {
      return { __html: content || '' };
    }
  };

  const summary = document?.summary;

  return (
    <div className="w-[420px] border-l border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 flex flex-col h-full flex-shrink-0 transition-colors">
      {/* Chat Header */}
      <div className="h-12 px-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <div>
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-200">Document Assistant</h3>
            <p className="text-[10px] text-slate-400 dark:text-slate-500">Answers strictly from your uploaded text</p>
          </div>
        </div>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Welcome & Day 3 Structured Summary */}
        <div className="flex items-start space-x-3">
          <div className="w-7 h-7 rounded-xl bg-blue-600 text-white flex items-center justify-center flex-shrink-0 mt-0.5 shadow-xs">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-sm p-4 text-xs text-slate-700 dark:text-slate-300 shadow-2xs max-w-sm leading-relaxed">
            {summary ? (
              <div className="space-y-2.5">
                <p className="font-semibold text-sm text-slate-900 dark:text-white">
                  📄 {summary.title || document.filename}
                </p>
                <div>
                  <span className="font-semibold text-[11px] text-slate-800 dark:text-slate-200 block mb-0.5">
                    Executive Brief:
                  </span>
                  <p className="text-[11.5px] text-slate-600 dark:text-slate-300 leading-normal">
                    {summary.executive_summary}
                  </p>
                </div>

                {summary.key_topics && summary.key_topics.length > 0 && (
                  <div>
                    <span className="font-semibold text-[11px] text-slate-800 dark:text-slate-200 block mb-1">
                      Key Themes:
                    </span>
                    <ul className="space-y-1 text-[11.5px]">
                      {summary.key_topics.map((t, idx) => (
                        <li key={idx} className="flex items-start space-x-1.5">
                          <span className="text-blue-500 font-bold">•</span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-800">
                  Ask me anything below, or click one of the suggested topics!
                </p>
              </div>
            ) : (
              <div>
                <p className="font-medium text-slate-900 dark:text-white mb-1">Welcome to docsLeans!</p>
                <p>
                  I've read <strong className="text-slate-900 dark:text-white">{document?.filename}</strong>. You can ask
                  questions, or highlight any text on the left to focus the answer!
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Dynamic Suggested Questions */}
        {summary?.suggested_questions && messages.length === 0 && (
          <div className="pt-1">
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-2 px-1">
              Suggested Questions:
            </p>
            <div className="flex flex-col space-y-1.5">
              {summary.suggested_questions.map((q, idx) => (
                <button
                  key={idx}
                  type="button"
                  disabled={loading}
                  onClick={() => onSendMessage(q)}
                  className="text-left text-xs bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-850 border border-slate-200 dark:border-slate-800 hover:border-blue-400 text-slate-700 dark:text-slate-200 px-3 py-2 rounded-xl transition-all shadow-2xs disabled:opacity-50"
                >
                  💡 {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Conversation History */}
        {messages.map((m, i) => (
          <div
            key={m.id || i}
            className={`flex items-start space-x-2.5 ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {m.sender === 'assistant' && (
              <div className="w-7 h-7 rounded-xl bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40 flex items-center justify-center flex-shrink-0 mt-0.5 shadow-2xs">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
            )}

            <div
              className={`rounded-2xl p-3.5 text-xs max-w-sm leading-relaxed shadow-2xs ${
                m.sender === 'user'
                  ? 'bg-blue-600 text-white rounded-tr-xs'
                  : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-tl-xs text-slate-800 dark:text-slate-200'
              }`}
            >
              {m.selected_context && (
                <div className="mb-2 bg-blue-700/60 text-blue-100 p-2 rounded-lg text-[11px] italic truncate">
                  Pin: "{m.selected_context}"
                </div>
              )}
              {m.sender === 'user' ? (
                <p>{m.content}</p>
              ) : (
                <div className="chat-markdown" dangerouslySetInnerHTML={renderMarkdown(m.content)} />
              )}
            </div>
          </div>
        ))}

        {/* Loading Indicator */}
        {loading && (
          <div className="flex items-start space-x-3">
            <div className="w-7 h-7 rounded-xl bg-blue-100/80 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/40 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Sparkles className="w-3.5 h-3.5" />
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl rounded-tl-sm px-3.5 py-3 text-xs text-slate-500 dark:text-slate-400 flex items-center space-x-1.5 shadow-2xs">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.2s]"></span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-bounce [animation-delay:0.4s]"></span>
              <span className="text-[11px] text-slate-400 ml-1">Analyzing document & drafting answer...</span>
            </div>
          </div>
        )}

        <div ref={feedEndRef} />
      </div>

      {/* Input Bar */}
      <div className="p-3.5 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
        {pinnedContext && (
          <div className="mb-2 items-center justify-between bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 px-3 py-1.5 rounded-xl text-xs text-amber-950 dark:text-amber-200 shadow-2xs flex">
            <div className="flex items-center space-x-1.5 truncate">
              <Pin className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 flex-shrink-0" />
              <span className="font-semibold text-[11px] text-amber-800 dark:text-amber-300">Context:</span>
              <span className="truncate italic text-slate-700 dark:text-slate-300">{pinnedContext}</span>
            </div>
            <button
              type="button"
              onClick={onClearPinnedContext}
              className="ml-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex items-center space-x-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={loading}
            placeholder="Ask a question about the document..."
            className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="bg-blue-600 hover:bg-blue-500 text-white p-2.5 rounded-xl transition-all shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
