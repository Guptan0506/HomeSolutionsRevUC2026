import React, { useState } from 'react';
import { buildApiUrl } from '../api';

function RequestForm({ currentUser, selectedProvider, onBack, onSuccess }) {
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('Low');
  const [dateRequired, setDateRequired] = useState('');
  const [serviceName, setServiceName] = useState('General Home Service');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!currentUser?.user_id) {
      setError('You must be logged in to submit a request.');
      return;
    }

    if (!selectedProvider?.sp_id && !selectedProvider?.id) {
      setError('Please select a provider from the list first.');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = {
        user_id: currentUser.user_id,
        sp_id: selectedProvider.sp_id || selectedProvider.id,
        service_name: serviceName,
        date_required: dateRequired || null,
        urgency,
        description,
        attachment_url: null,
        work_address: address,
        work_latitude: null,
        work_longitude: null,
      };

      const response = await fetch(buildApiUrl('/api/requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Unable to submit request right now.');
      }

      alert('Request submitted successfully!');
      setDescription('');
      setAddress('');
      setUrgency('Low');
      setDateRequired('');
      setServiceName('General Home Service');
      onSuccess();
    } catch (err) {
      setError(err.message || 'Unable to submit request right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="section-wrap">
      <div className="sec-label">Request Service</div>

      <form onSubmit={handleSubmit} className="card form-card" style={{ padding: '20px' }}>
        {selectedProvider && (
          <div className="provider-highlight">
            <p className="provider-highlight-kicker">Selected professional</p>
            <p className="provider-highlight-name">{selectedProvider.sp_name || selectedProvider.full_name}</p>
            <p className="provider-highlight-sub">
              {selectedProvider.specialization || selectedProvider.service_type} • ${selectedProvider.hourly_charge || selectedProvider.hourly_rate}/hr
            </p>
          </div>
        )}

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label">
            Service needed
          </label>
          <input
            type="text"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            placeholder="Plumbing, electrical, appliance repair..."
            value={serviceName}
            onChange={(e) => setServiceName(e.target.value)}
            required
          />
        </div>

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
            Preferred date
          </label>
          <input
            type="date"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            value={dateRequired}
            onChange={(e) => setDateRequired(e.target.value)}
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

        {error && <p className="auth-error" style={{ marginBottom: '12px' }}>{error}</p>}

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