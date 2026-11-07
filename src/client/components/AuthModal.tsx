import React, { useState } from "react";
import {
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import type { ConfirmationResult, User as FirebaseUser } from "firebase/auth";
import {
  clearRecaptchaVerifier,
  isFirebaseConfigured,
  sendPhoneOtp,
  signInOrRegisterEmail,
  signInWithGooglePopup,
  signOutFirebase,
  verifyPhoneOtp,
} from "../lib/firebase";
import { getOrCreateAspirantId, rotateNewGuestAspirantId } from "../lib/api";
import type { LangCode } from "../lib/i18n";

interface AuthModalProps {
  lang: LangCode;
  fbUser: FirebaseUser | null;
  onClose: () => void;
  onAuthenticated: () => Promise<void>;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  lang,
  fbUser,
  onClose,
  onAuthenticated,
}) => {
  const [authTab, setAuthTab] = useState<"PHONE" | "EMAIL">("PHONE");
  const [emailMode, setEmailMode] = useState<"signin" | "signup">("signin");

  // Phone OTP states
  const [phoneInput, setPhoneInput] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneConfirmation, setPhoneConfirmation] = useState<ConfirmationResult | null>(null);

  // Email states
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const handleClose = () => {
    clearRecaptchaVerifier();
    onClose();
  };

  const handleGoogle = async () => {
    setBusy(true);
    setError(null);
    setInfoMsg(null);
    try {
      await signInWithGooglePopup();
      await onAuthenticated();
      handleClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Google Sign-In failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneInput.trim()) return;
    setBusy(true);
    setError(null);
    setInfoMsg(null);
    try {
      const confirmation = await sendPhoneOtp(phoneInput.trim(), "sankalp-recaptcha-container");
      setPhoneConfirmation(confirmation);
      setInfoMsg(
        lang === "HI"
          ? "6-अंकीय OTP भेज दिया गया है। कृपया नीचे दर्ज करें।"
          : "6-digit OTP sent! Enter the verification code below."
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to send OTP";
      if (msg.includes("billing-not-enabled")) {
        setError(
          "Firebase $0 Spark tier restricts live carrier SMS; use pre-configured Spark Test Number +91 9999999999 (OTP: 123456) or +91 9876543210 (OTP: 654321), or sign in with Google!"
        );
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneConfirmation || !otpCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneOtp({
        confirmation: phoneConfirmation,
        otpCode,
        displayName,
      });
      await onAuthenticated();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Invalid OTP code");
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInOrRegisterEmail({ mode: emailMode, email, password, displayName });
      await onAuthenticated();
      handleClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOutAll = async () => {
    setBusy(true);
    try {
      await signOutFirebase();
      rotateNewGuestAspirantId();
      await onAuthenticated();
      handleClose();
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
              {lang === "HI" ? "खाता लॉगिन एवं पंजीकरण" : "Sign In / Register Account"}
            </h2>
          </div>
          <button onClick={handleClose} className="p-1 rounded-lg hover:bg-white/15 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4 max-h-[85vh] overflow-y-auto">
          {/* Active Identity & 1-Click Sign Out / Reset Guest */}
          {fbUser ? (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-emerald-900 font-bold">
                  <UserCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    {fbUser.displayName || fbUser.phoneNumber || fbUser.email || "Signed In"}
                  </span>
                </div>
                <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-200/70 text-emerald-900">
                  Verified
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOutAll}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 text-xs transition cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                {lang === "HI" ? "साइन आउट करें (Sign Out)" : "Sign Out of Account"}
              </button>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-slate-700">
                <UserCheck className="w-4 h-4 text-slate-500 shrink-0" />
                <span>
                  {lang === "HI" ? "अतिथि सत्र:" : "Guest Session:"}{" "}
                  <code className="font-mono-metric text-[11px]">{getOrCreateAspirantId()}</code>
                </span>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={handleSignOutAll}
                title="Reset to a brand-new clean Guest profile"
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                {lang === "HI" ? "नया अतिथि" : "New Guest"}
              </button>
            </div>
          )}

          {isFirebaseConfigured && (
            <>
              {/* 1. One-Click Google Sign-In */}
              <button
                type="button"
                disabled={busy}
                onClick={handleGoogle}
                className="w-full rounded-xl border-2 border-slate-200 hover:border-[#1E3A8A] hover:bg-indigo-50/40 py-2.5 px-4 text-sm font-bold text-slate-800 transition flex items-center justify-center gap-2.5 cursor-pointer"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#EA4335"
                    d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.8-5.5 3.8-3.3 0-6-2.7-6-6s2.7-6 6-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.4 14.6 2.5 12 2.5 6.8 2.5 2.5 6.8 2.5 12s4.3 9.5 9.5 9.5c5.5 0 9.1-3.8 9.1-9.2 0-.6-.1-1.1-.2-1.6H12z"
                  />
                </svg>
                <span>
                  {lang === "HI" ? "Google के साथ जारी रखें" : "Continue with Google"}
                </span>
              </button>

              <div className="relative flex py-0.5 items-center">
                <div className="grow border-t border-slate-200" />
                <span className="shrink mx-3 text-[11px] uppercase text-slate-400 font-semibold">
                  {lang === "HI" ? "या मोबाइल / ईमेल" : "or Mobile OTP / Email"}
                </span>
                <div className="grow border-t border-slate-200" />
              </div>

              {/* Method Switcher: Phone OTP vs Email */}
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("PHONE");
                    setError(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
                    authTab === "PHONE"
                      ? "bg-white text-[#1E3A8A] shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Phone className="w-3.5 h-3.5" />
                  {lang === "HI" ? "मोबाइल OTP" : "Phone Number"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("EMAIL");
                    setError(null);
                  }}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition cursor-pointer ${
                    authTab === "EMAIL"
                      ? "bg-white text-[#1E3A8A] shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  {lang === "HI" ? "ईमेल पासवर्ड" : "Email"}
                </button>
              </div>

              {/* 2. Phone Number OTP Registration & Sign-In */}
              {authTab === "PHONE" ? (
                <div className="space-y-3">
                  {!phoneConfirmation ? (
                    <form onSubmit={handleSendOtp} className="space-y-3">
                      <input
                        type="text"
                        placeholder={
                          lang === "HI"
                            ? "आपका नाम (वैकल्पिक, जैसे सुधीर)"
                            : "Your Name (optional, for new registration)"
                        }
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="w-full rounded-xl border border-slate-300 px-3.5 py-2 text-sm focus:outline-none focus:border-[#1E3A8A]"
                      />
                      <div className="flex items-center gap-2">
                        <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-mono-metric font-bold text-slate-700">
                          +91
                        </span>
                        <input
                          type="tel"
                          required
                          placeholder="9999999999"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          className="flex-1 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-mono-metric focus:outline-none focus:border-[#1E3A8A]"
                        />
                      </div>
                      <div className="rounded-lg bg-indigo-50/70 border border-indigo-100 px-3 py-2 text-[11px] text-indigo-900">
                        {lang === "HI"
                          ? "टेस्ट नंबर ($0 Spark): 9999999999 (OTP: 123456) या 9876543210 (OTP: 654321)"
                          : "Instant $0 Spark Test Numbers: 9999999999 (OTP: 123456) or 9876543210 (OTP: 654321)"}
                      </div>
                      <button
                        type="submit"
                        disabled={busy}
                        className="w-full rounded-xl bg-[#1E3A8A] hover:bg-indigo-900 text-white font-bold py-2.5 text-sm flex items-center justify-center gap-2 transition cursor-pointer"
                      >
                        <Phone className="w-4 h-4" />
                        {busy
                          ? "..."
                          : lang === "HI"
                            ? "OTP प्राप्त करें"
                            : "Send 6-Digit OTP"}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} className="space-y-3">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        required
                        placeholder="Enter 6-digit OTP (e.g. 123456)"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="w-full rounded-xl border-2 border-[#1E3A8A] px-3.5 py-2.5 text-center text-base font-mono-metric font-extrabold tracking-widest focus:outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setPhoneConfirmation(null);
                            setOtpCode("");
                          }}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                          {lang === "HI" ? "नंबर बदलें" : "Change Number"}
                        </button>
                        <button
                          type="submit"
                          disabled={busy}
                          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 text-sm transition cursor-pointer"
                        >
                          {busy
                            ? "..."
                            : lang === "HI"
                              ? "सत्यापित करें एवं लॉगिन करें"
                              : "Verify OTP & Sign In"}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              ) : (
                /* 3. Email & Password Sign-In / Registration */
                <div className="space-y-3">
                  <form onSubmit={handleEmailSubmit} className="space-y-3">
                    {emailMode === "signup" && (
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
                      {emailMode === "signin" ? "Sign In with Email" : "Create Aspirant Account"}
                    </button>
                  </form>

                  <div className="text-center text-xs text-slate-600">
                    {emailMode === "signin" ? "New to Sankalp? " : "Already registered? "}
                    <button
                      type="button"
                      onClick={() => setEmailMode(emailMode === "signin" ? "signup" : "signin")}
                      className="text-[#1E3A8A] font-semibold hover:underline cursor-pointer"
                    >
                      {emailMode === "signin" ? "Create account" : "Sign in"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          <div id="sankalp-recaptcha-container" />

          {infoMsg && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-900 font-medium">
              {infoMsg}
            </div>
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
