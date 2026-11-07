import React, { useState } from "react";
import { Mail, ShieldCheck, X, UserCheck } from "lucide-react";
import {
  isFirebaseConfigured,
  signInOrRegisterEmail,
  signInWithGooglePopup,
} from "../lib/firebase";
import { getOrCreateAspirantId } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface AuthModalProps {
  lang: LangCode;
  onClose: () => void;
  onAuthenticated: () => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({ lang, onClose, onAuthenticated }) => {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGooglePopup();
      await onAuthenticated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google Sign-In failed";
      if (msg.includes("configuration-not-found") || msg.includes("operation-not-allowed")) {
        setError(
          "Enable Google Sign-In in Firebase Console → Authentication → Sign-in method for project 'sankalp-uppcs-app'. Your local Aspirant profile is already synced to Neon Postgres!"
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInOrRegisterEmail({ mode, email, password, displayName });
      await onAuthenticated();
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Authentication failed";
      if (msg.includes("configuration-not-found") || msg.includes("operation-not-allowed")) {
        setError(
          "Enable Email/Password provider in Firebase Console → Authentication → Sign-in method for 'sankalp-uppcs-app'."
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">
        <div className="bg-[#1E3A8A] px-6 py-4 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-indigo-200" />
            <h2 className="font-bold text-base">
              {lang === "HI" ? "संकल्प क्लाउड सिंक (Firebase Auth)" : "Sankalp Cloud Sync (Firebase Auth)"}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/15">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-700">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              <span>Active Aspirant Session (Neon Synced):</span>
            </div>
            <code className="font-mono-metric text-[11px] bg-white border border-slate-200 px-2 py-0.5 rounded">
              {getOrCreateAspirantId()}
            </code>
          </div>

          {isFirebaseConfigured && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogle}
                className="w-full rounded-xl border border-slate-300 hover:bg-slate-50 py-2.5 px-4 text-sm font-semibold text-slate-800 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Continue with Google (Firebase Spark)</span>
              </button>

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-slate-200" />
                <span className="shrink mx-3 text-[11px] uppercase text-slate-400 font-semibold">
                  or email
                </span>
                <div className="grow border-t border-slate-200" />
              </div>

              <form onSubmit={handleEmailSubmit} className="space-y-3">
                {mode === "signup" && (
                  <input
                    type="text"
                    placeholder="Full Name (e.g., Sudhir Pandey)"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:border-[#1E3A8A]"
                  />
                )}
                <input
                  type="email"
                  required
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:border-[#1E3A8A]"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Password (min 6 chars)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:border-[#1E3A8A]"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-semibold py-2.5 text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  {mode === "signin" ? "Sign In with Email" : "Create Aspirant Account"}
                </button>
              </form>

              <div className="text-center text-xs text-slate-600">
                {mode === "signin" ? "New to Sankalp? " : "Already registered? "}
                <button
                  type="button"
                  onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
                  className="text-[#1E3A8A] font-semibold hover:underline"
                >
                  {mode === "signin" ? "Create account" : "Sign in"}
                </button>
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900 leading-relaxed">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
