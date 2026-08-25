import { apiCall } from './api.js';

const QUEUE_STORAGE_KEY = 'orbit_offline_attendance_queue';

/**
 * Get all queued offline punches
 */
export function getOfflineQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

/**
 * Queue an attendance punch locally when client is offline
 */
export function queueOfflinePunch(punchData) {
  try {
    const queue = getOfflineQueue();
    const payload = {
      ...punchData,
      id: `OFFLINE_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString()
    };
    queue.push(payload);
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
    console.log(`[OFFLINE QUEUE]: Stored attendance punch locally (${queue.length} pending).`);
    return payload;
  } catch (err) {
    console.error(`[OFFLINE QUEUE ERROR]: Failed to save offline punch`, err);
    return null;
  }
}

/**
 * Synchronize all offline punches to the self-hosted Express backend
 */
export async function syncOfflineQueue() {
  if (!navigator.onLine) return { syncedCount: 0, total: 0 };

  const queue = getOfflineQueue();
  if (queue.length === 0) return { syncedCount: 0, total: 0 };

  console.log(`[OFFLINE SYNC]: Network restored. Syncing ${queue.length} offline punches...`);
  let syncedCount = 0;
  const remainingQueue = [];

  for (const item of queue) {
    try {
      const res = await apiCall('/attendance/public-scan', 'POST', item);
      if (res && res.success) {
        syncedCount++;
      } else {
        remainingQueue.push(item);
      }
    } catch (err) {
      console.warn(`[OFFLINE SYNC FAIL]: Punch ID ${item.id} sync failed`, err);
      remainingQueue.push(item);
    }
  }

  localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(remainingQueue));
  console.log(`[OFFLINE SYNC COMPLETE]: Successfully synced ${syncedCount}/${queue.length} punches.`);

  return { syncedCount, remaining: remainingQueue.length };
}

// Auto-listen to online reconnection event
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncOfflineQueue();
  });
}
