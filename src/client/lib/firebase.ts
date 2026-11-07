import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  signOut,
  onAuthStateChanged,
  type Auth,
  type ConfirmationResult,
  type User as FirebaseUser,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined) || "sankalp-uppcs-app",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const isFirebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let recaptchaVerifierInstance: RecaptchaVerifier | null = null;

export function getFirebaseAuth(): Auth | null {
  if (!isFirebaseConfigured) return null;
  if (!appInstance) {
    appInstance = getApps().length > 0 ? getApps()[0]! : initializeApp(firebaseConfig);
  }
  if (!authInstance) {
    authInstance = getAuth(appInstance);
  }
  return authInstance;
}

export function clearRecaptchaVerifier(): void {
  if (recaptchaVerifierInstance) {
    try {
      recaptchaVerifierInstance.clear();
    } catch {
      // ignore cleanup error
    }
    recaptchaVerifierInstance = null;
  }
}

export async function sendPhoneOtp(
  rawPhone: string,
  containerId: string
): Promise<ConfirmationResult> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error("Firebase Web SDK config is missing in environment.");
  }

  const cleaned = rawPhone.replace(/[\s()-]/g, "");
  const formattedPhone = cleaned.startsWith("+")
    ? cleaned
    : cleaned.length === 10
      ? `+91${cleaned}`
      : `+${cleaned}`;

  clearRecaptchaVerifier();
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = "";
  }

  recaptchaVerifierInstance = new RecaptchaVerifier(auth, containerId, {
    size: "invisible",
  });

  return await signInWithPhoneNumber(auth, formattedPhone, recaptchaVerifierInstance);
}

export async function verifyPhoneOtp(params: {
  confirmation: ConfirmationResult;
  otpCode: string;
  displayName?: string;
}): Promise<FirebaseUser> {
  const cred = await params.confirmation.confirm(params.otpCode.trim());
  if (params.displayName?.trim()) {
    await updateProfile(cred.user, { displayName: params.displayName.trim() });
  }
  clearRecaptchaVerifier();
  return cred.user;
}

export async function signInWithGooglePopup(): Promise<FirebaseUser> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error("Firebase Web SDK config is missing in environment.");
  }
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

export async function signInOrRegisterEmail(params: {
  mode: "signin" | "signup";
  email: string;
  password: string;
  displayName?: string;
}): Promise<FirebaseUser> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error("Firebase Web SDK config is missing in environment.");
  }
  if (params.mode === "signup") {
    const cred = await createUserWithEmailAndPassword(auth, params.email, params.password);
    if (params.displayName?.trim()) {
      await updateProfile(cred.user, { displayName: params.displayName.trim() });
    }
    return cred.user;
  }
  const cred = await signInWithEmailAndPassword(auth, params.email, params.password);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth) {
    await signOut(auth);
  }
}

export function subscribeFirebaseUser(cb: (user: FirebaseUser | null) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, cb);
}

export async function getFreshFirebaseToken(): Promise<string | null> {
  const auth = getFirebaseAuth();
  if (!auth?.currentUser) return null;
  try {
    return await auth.currentUser.getIdToken();
  } catch {
    return null;
  }
}
