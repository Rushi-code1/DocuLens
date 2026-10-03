import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Lock, User, Mail, AlertCircle, ArrowRight } from 'lucide-react';
import docsleansIcon from '../assets/docsleans-icon.png';

export default function AuthModal({ isOpen, onClose }) {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      if (isRegister) {
        await register(username, email, password);
      } else {
        await login(username, password);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Authentication failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/60 dark:bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[#FAF9F5] dark:bg-slate-900 border border-[#E7E5E0] dark:border-slate-800 rounded-3xl p-7 max-w-sm w-full shadow-2xl relative transition-all">
        {/* Header */}
        <div className="flex items-center space-x-2.5 mb-2">
          <img
            src={docsleansIcon}
            alt="docsLeans"
            className="w-8 h-8 rounded-xl object-contain shadow-xs"
          />
          <div>
            <h3 className="text-base font-semibold text-stone-900 dark:text-white">
              {isRegister ? 'Create an Account' : 'Welcome to docsLeans'}
            </h3>
            <p className="text-[11px] text-stone-500 dark:text-slate-400">
              {isRegister ? 'Sign up to save your documents & chat history' : 'Sign in to access your saved documents'}
            </p>
          </div>
        </div>

        {error && (
          <div className="mt-3 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 rounded-xl p-2.5 flex items-start space-x-2 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-stone-600 dark:text-slate-300 mb-1">
              Username
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. alex"
                className="w-full bg-[#EFECE6] dark:bg-slate-950 border border-[#D6D3CD] dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-800 dark:text-slate-100 placeholder-stone-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {isRegister && (
            <div>
              <label className="block text-[11px] font-medium text-stone-600 dark:text-slate-300 mb-1">
                Email Address (Optional)
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                  className="w-full bg-[#EFECE6] dark:bg-slate-950 border border-[#D6D3CD] dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-800 dark:text-slate-100 placeholder-stone-400 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-medium text-stone-600 dark:text-slate-300 mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-stone-400 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#EFECE6] dark:bg-slate-950 border border-[#D6D3CD] dark:border-slate-700 rounded-xl pl-9 pr-3 py-2 text-xs text-stone-800 dark:text-slate-100 placeholder-stone-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl py-2.5 text-xs font-medium transition-all shadow-xs flex items-center justify-center space-x-1.5 disabled:opacity-50"
          >
            <span>{submitting ? 'Authenticating...' : isRegister ? 'Create Account' : 'Sign In'}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-[#E7E5E0] dark:border-slate-800 text-center">
          <p className="text-[11px] text-stone-500 dark:text-slate-400">
            {isRegister ? 'Already have an account?' : "Don't have an account yet?"}{' '}
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
              }}
              className="text-blue-600 dark:text-blue-400 font-semibold hover:underline"
            >
              {isRegister ? 'Sign In' : 'Create Account'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
