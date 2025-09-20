import fs from "fs";
import path from "path";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { Firestore, getFirestore } from "firebase-admin/firestore";

type ServiceAccountCredentials = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

let firestore: Firestore | null | undefined;
let initError: Error | null = null;

function resolveCredentials(): ServiceAccountCredentials | null {
  const fromEnvJson = loadFromJsonString(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (fromEnvJson) return fromEnvJson;

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  if (filePath) {
    const resolved = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    const fromFile = loadFromFile(resolved);
    if (fromFile) return fromFile;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = privateKeyRaw?.replace(/\\n/g, "\n");
  if (projectId && clientEmail && privateKey) {
    return { projectId, clientEmail, privateKey };
  }

  return null;
}

function loadFromJsonString(json?: string | null): ServiceAccountCredentials | null {
  if (!json) return null;
  try {
    return normalizeServiceAccount(JSON.parse(json));
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

function loadFromFile(filePath: string): ServiceAccountCredentials | null {
  try {
    if (!fs.existsSync(filePath)) throw new Error(`Service account file not found: ${filePath}`);
    const raw = fs.readFileSync(filePath, "utf8");
    return normalizeServiceAccount(JSON.parse(raw));
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    return null;
  }
}

function normalizeServiceAccount(data: any): ServiceAccountCredentials | null {
  if (!data) return null;
  const projectId = data.project_id ?? data.projectId;
  const clientEmail = data.client_email ?? data.clientEmail;
  const privateKeyRaw = data.private_key ?? data.privateKey;
  if (!projectId || !clientEmail || !privateKeyRaw) {
    throw new Error("Invalid service account JSON: missing required fields");
  }
  const privateKey = String(privateKeyRaw).replace(/\\n/g, "\n");
  return { projectId: String(projectId), clientEmail: String(clientEmail), privateKey };
}

function initFirestore(): Firestore | null {
  if (firestore !== undefined) return firestore;

  try {
    const existing = getApps();
    if (existing.length) {
      firestore = getFirestore(existing[0]);
      return firestore;
    }

    const creds = resolveCredentials();
    if (creds) {
      const app = initializeApp({
        credential: cert({
          projectId: creds.projectId,
          clientEmail: creds.clientEmail,
          privateKey: creds.privateKey,
        }),
      });
      firestore = getFirestore(app);
      return firestore;
    }

    initError = new Error("Firebase Admin credentials are not configured");
    firestore = null;
    return firestore;
  } catch (error) {
    initError = error instanceof Error ? error : new Error(String(error));
    firestore = null;
    return firestore;
  }
}

export function getFirestoreAdmin(): Firestore | null {
  return initFirestore();
}

export function getFirestoreInitError(): Error | null {
  return initError;
}
