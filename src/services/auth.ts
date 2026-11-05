import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { app, db } from './dnsCore';

export const auth = getAuth(app);

export function subscribeToAuth(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export async function signIn(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return signInWithPopup(auth, provider);
}

export async function signOut() {
  return firebaseSignOut(auth);
}

export async function isDNSAdmin(uid: string) {
  const snapshot = await getDoc(doc(db, 'users', uid));
  if (!snapshot.exists()) return false;
  const data = snapshot.data() as { active?: boolean; globalRoles?: string[] };
  return data.active === true && Array.isArray(data.globalRoles) && data.globalRoles.includes('dns-admin');
}
