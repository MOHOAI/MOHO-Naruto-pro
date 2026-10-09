import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  signOut,
  GoogleAuthProvider,
  onAuthStateChanged,
  type User
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  deleteDoc,
  updateDoc,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

// Test connection on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client appears offline or connecting...');
    }
  }
}
testConnection();

// Standard Error Handling
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Google Auth Provider setup with Tasks scopes
export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('https://www.googleapis.com/auth/tasks');
googleProvider.addScope('https://www.googleapis.com/auth/tasks.readonly');

let cachedAccessToken: string | null = null;
let isSigningIn = false;

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

export const setCachedAccessToken = (token: string | null) => {
  cachedAccessToken = token;
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      console.warn('Access token not returned directly from credential; will use session');
    }
    cachedAccessToken = credential?.accessToken || null;
    return { user: result.user, accessToken: cachedAccessToken || '' };
  } catch (error) {
    console.error('Google Sign-in failed:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const googleSignOut = async (): Promise<void> => {
  await signOut(auth);
  cachedAccessToken = null;
};

export const initAuth = (
  onAuthSuccess?: (user: User, token: string | null) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

// User Watching Progress
export interface StoredProgress {
  userId: string;
  currentEpisode: number;
  playbackTime: number;
  watchedEpisodes: number[];
  updatedAt: string;
}

export async function saveProgressToFirestore(
  userId: string,
  progress: { current: number; time: number; watched: number[] }
): Promise<void> {
  const path = `users/${userId}/progress/current`;
  try {
    const payload: StoredProgress = {
      userId,
      currentEpisode: Math.min(500, Math.max(1, Number(progress.current) || 1)),
      playbackTime: Math.max(0, Math.floor(Number(progress.time) || 0)),
      watchedEpisodes: Array.from(new Set(progress.watched || [])).slice(0, 500),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', userId, 'progress', 'current'), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function loadProgressFromFirestore(
  userId: string
): Promise<{ current: number; time: number; watched: number[] } | null> {
  const path = `users/${userId}/progress/current`;
  try {
    const snap = await getDoc(doc(db, 'users', userId, 'progress', 'current'));
    if (!snap.exists()) return null;
    const data = snap.data() as StoredProgress;
    return {
      current: data.currentEpisode || 1,
      time: data.playbackTime || 0,
      watched: data.watchedEpisodes || []
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

// Watch Schedule & Reminders
export interface WatchScheduleItem {
  id: string;
  userId: string;
  episodeNumber: number;
  episodeTitle: string;
  scheduledFor: string;
  googleTaskId?: string;
  status: 'pending' | 'completed' | 'cancelled';
  notes?: string;
  createdAt: string;
}

export async function saveScheduleToFirestore(
  userId: string,
  item: Omit<WatchScheduleItem, 'userId' | 'createdAt'>
): Promise<WatchScheduleItem> {
  const scheduleId = item.id || `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const path = `users/${userId}/schedules/${scheduleId}`;
  try {
    const payload: WatchScheduleItem = {
      id: scheduleId,
      userId,
      episodeNumber: Number(item.episodeNumber) || 1,
      episodeTitle: String(item.episodeTitle || `الحلقة ${item.episodeNumber}`).substring(0, 200),
      scheduledFor: String(item.scheduledFor || new Date().toISOString()).substring(0, 100),
      googleTaskId: item.googleTaskId ? String(item.googleTaskId).substring(0, 200) : '',
      status: item.status || 'pending',
      notes: item.notes ? String(item.notes).substring(0, 500) : '',
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', userId, 'schedules', scheduleId), payload);
    return payload;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function getSchedulesFromFirestore(userId: string): Promise<WatchScheduleItem[]> {
  const path = `users/${userId}/schedules`;
  try {
    const snap = await getDocs(collection(db, 'users', userId, 'schedules'));
    const items: WatchScheduleItem[] = [];
    snap.forEach((d) => {
      items.push(d.data() as WatchScheduleItem);
    });
    return items.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime());
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
  }
}

export async function deleteScheduleFromFirestore(userId: string, scheduleId: string): Promise<void> {
  const path = `users/${userId}/schedules/${scheduleId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'schedules', scheduleId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function updateScheduleStatusInFirestore(
  userId: string,
  scheduleId: string,
  status: 'pending' | 'completed' | 'cancelled'
): Promise<void> {
  const path = `users/${userId}/schedules/${scheduleId}`;
  try {
    await updateDoc(doc(db, 'users', userId, 'schedules', scheduleId), { status });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}
