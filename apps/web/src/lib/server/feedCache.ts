import { Firestore, Timestamp } from "firebase-admin/firestore";
import { FeedItem } from "../types";

export type FeedCacheDocument = {
  slug: string;
  dateKey: string;
  endpoint?: string;
  items: FeedItem[];
  fetchedAt: string;
  expiresAt: string;
  etag?: string;
  lastModified?: string;
};

export type AggregateCacheDocument = {
  key: string;
  dateKey: string;
  items: FeedItem[];
  fetchedAt: string;
  expiresAt: string;
};

const FEED_CACHE_COLLECTION = "feedCache";
const FEED_CACHE_SNAPSHOTS = "snapshots";
const AGGREGATE_COLLECTION = "feedAggregates";
const AGGREGATE_SNAPSHOTS = "snapshots";

function getTtlHours(): number {
  const raw = Number(process.env.FEED_CACHE_TTL_HOURS || "");
  if (Number.isFinite(raw) && raw > 0) return raw;
  return 6; // default 6 hours
}

export function getDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function computeExpiry(from = new Date()): string {
  const hours = getTtlHours();
  const ms = hours * 60 * 60 * 1000;
  return new Date(from.getTime() + ms).toISOString();
}

export function isFresh(doc: { expiresAt?: string | Timestamp | null }, now = new Date()): boolean {
  if (!doc?.expiresAt) return false;
  if (typeof doc.expiresAt === "string") return new Date(doc.expiresAt) > now;
  if (doc.expiresAt instanceof Timestamp) return doc.expiresAt.toDate() > now;
  return false;
}

function feedDoc(db: Firestore, slug: string, dateKey: string) {
  return db
    .collection(FEED_CACHE_COLLECTION)
    .doc(slug)
    .collection(FEED_CACHE_SNAPSHOTS)
    .doc(dateKey);
}

function aggregateDoc(db: Firestore, key: string, dateKey: string) {
  return db
    .collection(AGGREGATE_COLLECTION)
    .doc(key)
    .collection(AGGREGATE_SNAPSHOTS)
    .doc(dateKey);
}

export async function readFeedCache(db: Firestore, slug: string, dateKey: string): Promise<FeedCacheDocument | null> {
  const snap = await feedDoc(db, slug, dateKey).get();
  if (!snap.exists) return null;
  const data = snap.data() as FeedCacheDocument | undefined;
  if (!data) return null;
  return normalizeFeedCache(data);
}

export async function writeFeedCache(
  db: Firestore,
  slug: string,
  dateKey: string,
  payload: Omit<FeedCacheDocument, "slug" | "dateKey">
) {
  await feedDoc(db, slug, dateKey).set(
    {
      slug,
      dateKey,
      ...payload,
    },
    { merge: true }
  );
}

export async function updateFeedCacheMeta(
  db: Firestore,
  slug: string,
  dateKey: string,
  fields: Partial<Omit<FeedCacheDocument, "slug" | "dateKey" | "items">>
) {
  await feedDoc(db, slug, dateKey).set(fields, { merge: true });
}

export async function readAggregateCache(
  db: Firestore,
  key: string,
  dateKey: string
): Promise<AggregateCacheDocument | null> {
  const snap = await aggregateDoc(db, key, dateKey).get();
  if (!snap.exists) return null;
  const data = snap.data() as AggregateCacheDocument | undefined;
  if (!data) return null;
  return {
    ...data,
    fetchedAt: toIsoString(data.fetchedAt),
    expiresAt: toIsoString(data.expiresAt),
  };
}

export async function writeAggregateCache(
  db: Firestore,
  key: string,
  dateKey: string,
  payload: Omit<AggregateCacheDocument, "key" | "dateKey">
) {
  await aggregateDoc(db, key, dateKey).set(
    {
      key,
      dateKey,
      ...payload,
    },
    { merge: true }
  );
}

function normalizeFeedCache(data: FeedCacheDocument): FeedCacheDocument {
  return {
    ...data,
    fetchedAt: toIsoString(data.fetchedAt),
    expiresAt: toIsoString(data.expiresAt),
  };
}

function toIsoString(value: any): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Timestamp) return value.toDate().toISOString();
  return String(value);
}
