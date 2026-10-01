import { initializeApp } from 'firebase/app';
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

export const app = initializeApp(firebaseConfig);
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
