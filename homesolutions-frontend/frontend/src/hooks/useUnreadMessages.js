import { useState, useEffect } from 'react';
import { buildApiUrl, getAuthHeaders } from '../api';

/**
 * Custom hook to fetch and track unread message counts per request
 * Returns a map of { requestId: unreadCount }
 */
export function useUnreadMessages(userId, shouldFetch = true) {
  const [unreadCounts, setUnreadCounts] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!userId || !shouldFetch) {
      setUnreadCounts({});
      return;
    }

    const fetchUnreadCounts = async () => {
      setLoading(true);
      try {
        const response = await fetch(
          buildApiUrl(`/api/messages/unread-count/${userId}`),
          { headers: getAuthHeaders() }
        );
        
        if (!response.ok) {
          console.error('Failed to fetch unread message count');
          setLoading(false);
          return;
        }

        const data = await response.json();
        // data is now { request_id: unread_count, ... }
        setUnreadCounts(data || {});
      } catch (err) {
        console.error('Error fetching unread counts:', err);
      } finally {
        setLoading(false);
      }
    };

    const interval = setInterval(fetchUnreadCounts, 5000); // Poll every 5 seconds
    fetchUnreadCounts(); // Fetch immediately

    return () => clearInterval(interval);
  }, [userId, shouldFetch]);

  return { unreadCounts, loading };
}

export default useUnreadMessages;
