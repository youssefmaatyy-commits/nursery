import { useEffect, useState } from 'react';
import { failedCount, pendingCount, synchronize } from '@/lib/offline';

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const refreshCounts = async () => {
    setPending(await pendingCount());
    setFailed(await failedCount());
  };

  useEffect(() => {
    const handleOnline = async () => {
      setOnline(true);
      await synchronize();
      await refreshCounts();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    void refreshCounts();
    const timer = window.setInterval(() => { void refreshCounts(); }, 15000);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(timer);
    };
  }, []);

  return { online, pending, failed, refreshCounts };
}
