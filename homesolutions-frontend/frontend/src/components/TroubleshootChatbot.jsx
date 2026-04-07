import React, { useMemo, useState } from 'react';
import { FaBolt, FaDroplet, FaHammer, FaLeaf, FaPaintRoller, FaBroom, FaHouseChimney, FaShieldHalved, FaLock, FaBug, FaTree, FaToolbox, FaWrench } from 'react-icons/fa6';
import { sendTroubleshootMessage } from '../api';

const starterPrompts = [
  'My sink is leaking under the cabinet.',
  'My circuit breaker keeps tripping.',
  'My AC is not cooling properly.',
];

const SERVICE_META = [
  { match: ['electrical', 'electric'], icon: FaBolt, tag: 'Emergency' },
  { match: ['plumbing'], icon: FaDroplet, tag: 'Emergency' },
  { match: ['hvac', 'heating', 'cooling', 'ac'], icon: FaHouseChimney, tag: 'Seasonal' },
  { match: ['appliance repair', 'appliance'], icon: FaToolbox, tag: 'Popular' },
  { match: ['carpentry', 'carpenter', 'woodwork'], icon: FaHammer, tag: 'Custom' },
  { match: ['painting', 'painter', 'paint'], icon: FaPaintRoller, tag: 'Popular' },
  { match: ['landscaping', 'landscape', 'gardening', 'gardener'], icon: FaLeaf, tag: 'Seasonal' },
  { match: ['cleaning', 'cleaner'], icon: FaBroom, tag: 'Recurring' },
  { match: ['roofing', 'roofer'], icon: FaHouseChimney, tag: 'Priority' },
  { match: ['flooring', 'floor installer'], icon: FaHammer, tag: 'Upgrade' },
  { match: ['handyman', 'general repair', 'maintenance'], icon: FaWrench, tag: 'Popular' },
  { match: ['pest control', 'pest', 'extermination'], icon: FaBug, tag: 'Urgent' },
  { match: ['home security', 'security', 'alarm', 'smart lock', 'cameras'], icon: FaShieldHalved, tag: 'Smart Home' },
  { match: ['drywall', 'insulation', 'sheetrock', 'patching'], icon: FaHammer, tag: 'Repair' },
  { match: ['window cleaning', 'window washer', 'windows'], icon: FaBroom, tag: 'Recurring' },
  { match: ['tree trimming', 'tree removal', 'arborist', 'tree care'], icon: FaTree, tag: 'Seasonal' },
  { match: ['pool', 'spa', 'pool maintenance', 'pool service'], icon: FaDroplet, tag: 'Luxury' },
  { match: ['locksmith', 'lock', 'rekey', 'key replacement'], icon: FaLock, tag: 'Emergency' },
];

function normalizeServiceText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getServiceMeta(serviceLabel) {
  const normalized = normalizeServiceText(serviceLabel);
  const found = SERVICE_META.find((entry) => entry.match.some((term) => normalized.includes(normalizeServiceText(term))));

  return found || { icon: FaToolbox, tag: 'Home Service' };
}

function TroubleshootChatbot({ onNavigateToRequest }) {
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
      const response = await sendTroubleshootMessage(
        trimmed,
        historyPayload
      );

      const assistantMessage = {
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: response.assistantReply,
        complexity: response.complexity,
        recommendedServiceType: response.recommendedServiceType,
        safetyReminder: response.safetyReminder,
      };

      setMessages((prev) => [...prev, assistantMessage]);
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

  const handleSubmitRequest = (serviceType) => {
    if (onNavigateToRequest) {
      onNavigateToRequest(serviceType);
    } else {
      console.warn('Navigation callback not provided');
    }
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
              <div key={message.id}>
                <article
                  className={`chatbot-message ${message.role === 'assistant' ? 'assistant' : 'user'}`}
                >
                  <p>{message.content}</p>
                </article>
                {message.role === 'assistant' && message.recommendedServiceType && (
                  <div className="chatbot-request-section">
                    {(() => {
                      const meta = getServiceMeta(message.recommendedServiceType);
                      const RecommendedIcon = meta.icon || FaToolbox;

                      return (
                        <div className="chatbot-request-head">
                          <div className="chatbot-request-icon">
                            <RecommendedIcon aria-hidden="true" />
                          </div>
                          <div>
                            <p className="chatbot-request-label">Recommended service</p>
                            <p className="chatbot-request-service">{message.recommendedServiceType}</p>
                            <p className="chatbot-request-chip">{meta.tag || 'Home Service'}</p>
                          </div>
                        </div>
                      );
                    })()}
                    <p className="chatbot-request-text">
                      This likely needs a professional. Want to send a request?
                    </p>
                    <button
                      type="button"
                      className="btn-p chatbot-request-btn"
                      onClick={() => handleSubmitRequest(message.recommendedServiceType)}
                    >
                      Request {message.recommendedServiceType}
                    </button>
                  </div>
                )}
              </div>
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
