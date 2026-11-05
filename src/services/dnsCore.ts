import { initializeApp, getApps } from 'firebase/app';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAgxv6Z45-AfrusbFnCSyvYChRUBu6-vXc',
  authDomain: 'dns-core.firebaseapp.com',
  projectId: 'dns-core',
  storageBucket: 'dns-core.firebasestorage.app',
  messagingSenderId: '387653285986',
  appId: '1:387653285986:web:27ad6f2e9a41ea1aebb93b',
  measurementId: 'G-2G56PRYNME',
};

// Workspace uses this Firebase app name for the operator login. Firebase Auth
// persistence is keyed by API key and app name, not just the common origin.
// Keep the exact Workspace identity name so Faktura resumes its existing session.
const WORKSPACE_FIREBASE_APP_NAME = 'dns-core-staff';
const existing = getApps().find(candidate => candidate.name === WORKSPACE_FIREBASE_APP_NAME);
if (existing && (existing.options.projectId !== firebaseConfig.projectId || existing.options.apiKey !== firebaseConfig.apiKey)) {
  throw new Error('FAKTURA_WORKSPACE_FIREBASE_IDENTITY_MISMATCH');
}
export const app = existing ?? initializeApp(firebaseConfig, WORKSPACE_FIREBASE_APP_NAME);
export const db = getFirestore(app);

export interface DNSCoreProbe {
  state: 'loading' | 'ready' | 'error';
  organizations: number;
  reportingAreas: number;
  seasons: number;
  error?: string;
}

export async function probeDNSCore(): Promise<DNSCoreProbe> {
  try {
    const [organizations, reportingAreas, seasons] = await Promise.all([
      getDocs(collection(db, 'organizations')),
      getDocs(collection(db, 'reportingAreas')),
      getDocs(collection(db, 'seasons')),
    ]);

    return {
      state: 'ready',
      organizations: organizations.size,
      reportingAreas: reportingAreas.size,
      seasons: seasons.size,
    };
  } catch (error) {
    return {
      state: 'error',
      organizations: 0,
      reportingAreas: 0,
      seasons: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
