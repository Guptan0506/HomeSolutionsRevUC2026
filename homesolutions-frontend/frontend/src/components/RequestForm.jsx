import React, { useState } from 'react';

function RequestForm({ selectedProvider, onBack, onSuccess }) {
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('Low');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();

    setIsSubmitting(true);

    // Simulate submission while preserving current app behavior.
    await new Promise((resolve) => setTimeout(resolve, 500));

    alert('Request submitted successfully!');
    setDescription('');
    setAddress('');
    setUrgency('Low');
    setIsSubmitting(false);
    onSuccess();
  };

  return (
    <div className="section-wrap">
      <div className="sec-label">Request Service</div>

      <form onSubmit={handleSubmit} className="card form-card" style={{ padding: '20px' }}>
        {selectedProvider && (
          <div className="provider-highlight">
            <p className="provider-highlight-kicker">Selected professional</p>
            <p className="provider-highlight-name">{selectedProvider.full_name}</p>
            <p className="provider-highlight-sub">
              {selectedProvider.service_type} • ${selectedProvider.hourly_rate}/hr
            </p>
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label">
            What do you need help with?
          </label>
          <textarea 
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            rows="4"
            placeholder="Describe the issue (e.g., Leaking faucet in kitchen)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label">
            Service address
          </label>
          <input
            type="text"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            placeholder="123 Main St, Apartment 4B"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label className="field-label">
            Urgency Level
          </label>
          <select 
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
          >
            <option value="Low">Low (Can wait a few days)</option>
            <option value="Medium">Medium (Next 24 hours)</option>
            <option value="High">High (Emergency - ASAP)</option>
          </select>
        </div>

        <div className="form-actions">
          <button type="button" className="btn-s" onClick={onBack}>
            Back to Providers
          </button>
          <button type="submit" className="btn-p" disabled={isSubmitting}>
            {isSubmitting ? 'Submitting...' : 'Send Request'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default RequestForm;