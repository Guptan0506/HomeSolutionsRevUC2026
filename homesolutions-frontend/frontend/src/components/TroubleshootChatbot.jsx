import React, { useMemo, useState } from 'react';
import { sendTroubleshootMessage } from '../api';

const starterPrompts = [
  'My sink is leaking under the cabinet.',
  'My circuit breaker keeps tripping.',
  'My AC is not cooling properly.',
];

function TroubleshootChatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        'Hi! I can help with basic home troubleshooting. Tell me what is happening, and I will suggest safe step-by-step checks.',
    },
  ]);

  const canSend = useMemo(
    () => !isLoading && inputValue.trim().length > 0,
    [isLoading, inputValue]
  );

  const buildHistoryPayload = (items) =>
    items
      .slice(-8)
      .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
      .map((entry) => ({
        role: entry.role,
        content: entry.content,
      }));

  const handleSend = async (text) => {
    const trimmed = text.trim();

    if (!trimmed || isLoading) {
      return;
    }

    const userMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const historyPayload = buildHistoryPayload(messages);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInputValue('');
    setError('');
    setIsLoading(true);

    try {
      const assistantReply = await sendTroubleshootMessage(
        trimmed,
        historyPayload
      );

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: assistantReply,
        },
      ]);
    } catch (err) {
      setError(err.message || 'Unable to get help at the moment.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    handleSend(inputValue);
  };

  return (
    <div className="chatbot-shell" aria-live="polite">
      <button
        type="button"
        className="chatbot-toggle"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-controls="chatbot-panel"
      >
        {isOpen ? 'Close Assistant' : 'Ask Home Assistant'}
      </button>

      {isOpen && (
        <section id="chatbot-panel" className="chatbot-panel" aria-label="Home troubleshooting assistant">
          <div className="chatbot-head">
            <p className="chatbot-title">Home Troubleshooting Assistant</p>
            <p className="chatbot-disclaimer">
              Basic guidance only. Stop if unsafe and contact a licensed professional for hazardous issues.
            </p>
          </div>

          <div className="chatbot-starters" aria-label="Suggested prompts">
            {starterPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="chatbot-starter-btn"
                onClick={() => handleSend(prompt)}
                disabled={isLoading}
              >
                {prompt}
              </button>
            ))}
          </div>

          <div className="chatbot-thread" role="log" aria-label="Conversation">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`chatbot-message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
              >
                <p>{message.content}</p>
              </article>
            ))}
            {isLoading && (
              <article className="chatbot-message assistant">
                <p>Thinking...</p>
              </article>
            )}
          </div>

          {error && <p className="chatbot-error">{error}</p>}

          <form className="chatbot-form" onSubmit={handleSubmit}>
            <input
              className="chatbot-input"
              type="text"
              placeholder="Describe your issue..."
              value={inputValue}
              onChange={(event) => setInputValue(event.target.value)}
              maxLength={500}
              disabled={isLoading}
            />
            <button type="submit" className="btn-p chatbot-send" disabled={!canSend}>
              Send
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

export default TroubleshootChatbot;
