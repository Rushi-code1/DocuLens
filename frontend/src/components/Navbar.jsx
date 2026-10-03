import React from 'react';
import { Sun, Moon, LogOut, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import docsleansIcon from '../assets/docsleans-icon.png';

export default function Navbar({
  activeDoc,
  theme,
  toggleTheme,
  onOpenAuth,
  onUploadClick
}) {
  const { user, logout } = useAuth();

  return (
    <header className="h-14 border-b border-[#E7E5E0] dark:border-slate-800 bg-[#FAF9F5] dark:bg-slate-900 px-5 flex items-center justify-between flex-shrink-0 z-20 transition-colors">
      {/* Brand / Logo */}
      <div className="flex items-center space-x-3">
        <img
          src={docsleansIcon}
          alt="docsLeans"
          className="w-8 h-8 rounded-xl object-contain shadow-xs"
        />
        <div>
          <div className="flex items-center space-x-2">
            <span className="font-bold text-sm tracking-tight text-stone-900 dark:text-white">
              docsLeans
            </span>
            <span className="text-[10px] bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 font-semibold px-2 py-0.5 rounded-full border border-blue-200/60 dark:border-blue-900">
              AI Reader
            </span>
          </div>
          <p className="text-[10px] text-stone-400 dark:text-slate-500 hidden sm:block">
            {activeDoc ? `Active: ${activeDoc.filename}` : 'Interactive Document Assistant'}
          </p>
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center space-x-2.5">
        {/* Dark Mode Toggle */}
        <button
          onClick={toggleTheme}
          className="w-8 h-8 rounded-xl border border-[#D6D3CD] dark:border-slate-700 bg-[#EFECE6] dark:bg-slate-800 text-stone-600 dark:text-slate-300 flex items-center justify-center hover:border-stone-400 dark:hover:border-slate-500 transition-colors"
          title="Toggle Theme"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
        </button>

        {/* User Account State */}
        {user ? (
          <div className="flex items-center space-x-2 pl-2 border-l border-[#E7E5E0] dark:border-slate-800">
            <div className="flex items-center space-x-1.5 bg-[#EFECE6] dark:bg-slate-800 border border-[#D6D3CD] dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs text-stone-700 dark:text-slate-200">
              <User className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
              <span className="font-medium text-[11px] truncate max-w-[120px]">{user.username}</span>
            </div>
            <button
              onClick={logout}
              className="p-1.5 rounded-xl border border-transparent hover:border-stone-300 dark:hover:border-slate-700 text-stone-400 hover:text-stone-700 dark:hover:text-slate-200 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={onOpenAuth}
            className="bg-blue-600 hover:bg-blue-500 text-white rounded-xl px-3 py-1.5 text-xs font-medium transition-all shadow-xs flex items-center space-x-1"
          >
            <span>Sign In</span>
          </button>
        )}
      </div>
    </header>
  );
}
