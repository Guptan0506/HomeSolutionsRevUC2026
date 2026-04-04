import React, { useEffect, useRef, useState } from 'react';
import { buildApiUrl, getApiErrorMessage, getAuthHeaders, readJsonSafely } from '../api';

function MessagingPanel({ requestId, otherPartyId, currentUser, otherPartyName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const messageEndRef = useRef(null);

  const scrollToBottom = () => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Fetch messages on mount or when requestId changes
  useEffect(() => {
    let isMounted = true;

    const fetchMessages = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(buildApiUrl(`/api/messages/${requestId}`), {
          headers: getAuthHeaders(),
        });

        const data = await readJsonSafely(response);

        if (!response.ok || !Array.isArray(data)) {
          throw new Error(getApiErrorMessage(response, data, 'Unable to load messages.'));
        }

        if (isMounted) {
          setMessages(data);

          // Mark any unread messages as read
          data.forEach((msg) => {
            if (!msg.is_read && msg.recipient_id === currentUser.user_id) {
              fetch(buildApiUrl(`/api/messages/${msg.message_id}/read`), {
                method: 'PATCH',
                headers: getAuthHeaders(),
              }).catch(() => {}); // Silently fail if marking read fails
            }
          });
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to load messages.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchMessages();

    return () => {
      isMounted = false;
    };
  }, [requestId, currentUser.user_id]);

  const handleSendMessage = async (e) => {
    e.preventDefault();

    if (!newMessage.trim()) {
      return;
    }

    setSending(true);
    setError('');

    try {
      // Determine recipient (the other party)
      const lastMessage = messages[messages.length - 1];
      let recipientId = null;

      if (lastMessage) {
        // If the last message is from the current user, reply to recipient
        if (lastMessage.sender_id === currentUser.user_id) {
          recipientId = lastMessage.recipient_id;
        } else {
          // Last message is from the other party
          recipientId = lastMessage.sender_id;
        }
      } else if (otherPartyId) {
        // No messages yet, use the otherPartyId prop
        recipientId = otherPartyId;
      }

      if (!recipientId) {
        setError('Unable to determine recipient. Please refresh.');
        setSending(false);
        return;
      }

      const payload = {
        request_id: requestId,
        sender_id: currentUser.user_id,
        sender_role: currentUser.user_role || 'customer',
        recipient_id: recipientId,
        message_text: newMessage.trim(),
      };

      const response = await fetch(buildApiUrl('/api/messages'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to send message.'));
      }

      // Add new message to list
      setMessages((prev) => [...prev, data]);
      setNewMessage('');
    } catch (err) {
      setError(err.message || 'Unable to send message.');
    } finally {
      setSending(false);
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (timestamp) => {
    const date = new Date(timestamp);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="messaging-panel">
      <div className="messaging-header">
        <div>
          <p className="messaging-title">Message with {otherPartyName || 'Service Provider'}</p>
          <p className="messaging-subtitle">Request #{requestId}</p>
        </div>
        {onClose && (
          <button
            type="button"
            className="messaging-close-btn"
            onClick={onClose}
            aria-label="Close messaging"
          >
            ✕
          </button>
        )}
      </div>

      <div className="messaging-body">
        {loading && <p style={{ textAlign: 'center', color: 'var(--ink-500)', padding: '20px' }}>Loading messages...</p>}

        {error && !loading && (
          <p style={{ color: '#c84141', padding: '12px', backgroundColor: '#fef2f2', borderRadius: '8px', margin: '12px' }}>
            {error}
          </p>
        )}

        {!loading && messages.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--ink-500)', padding: '40px 20px' }}>
            No messages yet. Start the conversation!
          </p>
        )}

        {!loading && messages.length > 0 && (
          <div className="messages-list">
            {messages.map((msg, idx) => {
              const isCurrentUser = msg.sender_id === currentUser.user_id;
              const showDate = idx === 0 || formatDate(msg.created_at) !== formatDate(messages[idx - 1].created_at);

              return (
                <div key={msg.message_id}>
                  {showDate && (
                    <p style={{ textAlign: 'center', fontSize: '12px', color: 'var(--ink-500)', marginTop: '16px', marginBottom: '12px' }}>
                      {formatDate(msg.created_at)}
                    </p>
                  )}
                  <div className={`message-row ${isCurrentUser ? 'message-sent' : 'message-received'}`}>
                    {!isCurrentUser && (
                      <div className="message-avatar">
                        {msg.sender_photo ? (
                          <img src={msg.sender_photo} alt={msg.sender_name} />
                        ) : (
                          <div className="message-avatar-fallback">
                            {(msg.sender_name || 'U').charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    )}
                    <div className={`message-bubble ${isCurrentUser ? 'bubble-sent' : 'bubble-received'}`}>
                      {!isCurrentUser && (
                        <p className="message-sender-name">{msg.sender_name || 'User'}</p>
                      )}
                      <p className="message-text">{msg.message_text}</p>
                      <p className="message-time">{formatTime(msg.created_at)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messageEndRef} />
          </div>
        )}
      </div>

      <form onSubmit={handleSendMessage} className="messaging-footer">
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="input-field"
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            disabled={sending || loading}
            style={{ flex: 1, padding: '10px', borderRadius: '8px' }}
          />
          <button
            type="submit"
            className="btn-p"
            disabled={sending || loading || !newMessage.trim()}
            style={{ padding: '10px 16px', minWidth: '80px' }}
          >
            {sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default MessagingPanel;
