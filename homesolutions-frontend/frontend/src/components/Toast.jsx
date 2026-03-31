import React, { useEffect } from 'react';

/**
 * Toast Notification Component
 * Displays temporary notifications with auto-dismiss after 4 seconds
 * Props: { message, type, onDismiss }
 * type: 'success' | 'error' | 'info'
 */
export default function Toast({ message, type = 'info', onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const toastClass = `toast toast-${type}`;

  return (
    <div className={toastClass}>
      <span>{message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={onDismiss}
        aria-label="Close notification"
      >
        ✕
      </button>
    </div>
  );
}
