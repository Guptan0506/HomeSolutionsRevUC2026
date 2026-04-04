import React, { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, getApiErrorMessage, getAuthHeaders, readJsonSafely } from '../api';

function RequestForm({ currentUser, selectedProvider, selectedService, onBack, onSuccess }) {
  const [requestTitle, setRequestTitle] = useState(selectedService || '');
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [urgency, setUrgency] = useState('Low');
  const [dateRequired, setDateRequired] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [providers, setProviders] = useState([]);
  const [selectedProviderIds, setSelectedProviderIds] = useState(
    selectedProvider?.sp_id || selectedProvider?.id ? [String(selectedProvider.sp_id || selectedProvider.id)] : []
  );
  const [isLoadingProviders, setIsLoadingProviders] = useState(true);
  const [providerLoadError, setProviderLoadError] = useState('');
  const [slotDate, setSlotDate] = useState('');
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [availabilitySlots, setAvailabilitySlots] = useState([]);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (selectedService && !requestTitle) {
      setRequestTitle(selectedService);
    }
  }, [selectedService, requestTitle]);

  useEffect(() => {
    let isMounted = true;

    const fetchProviders = async () => {
      setProviderLoadError('');
      setIsLoadingProviders(true);

      try {
        if (currentUser?.user_role === 'customer' && !currentUser?.location?.trim()) {
          throw new Error('Please add your location in your profile before requesting service.');
        }

        const params = new URLSearchParams();
        if (currentUser?.location?.trim()) {
          params.set('location', currentUser.location.trim());
        }

        const url = params.toString() ? buildApiUrl(`/api/providers?${params.toString()}`) : buildApiUrl('/api/providers');
        const response = await fetch(url);
        const data = await readJsonSafely(response);

        if (!response.ok || !Array.isArray(data)) {
          throw new Error(getApiErrorMessage(response, data, 'Unable to load providers right now.'));
        }

        if (isMounted) {
          setProviders(data);
        }
      } catch (err) {
        if (isMounted) {
          setProviderLoadError(err.message || 'Unable to load providers right now.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingProviders(false);
        }
      }
    };

    fetchProviders();

    return () => {
      isMounted = false;
    };
  }, [currentUser?.location, currentUser?.user_role]);

  const providerMap = useMemo(() => {
    const map = new Map();

    providers.forEach((provider) => {
      const id = provider.sp_id || provider.id;

      if (id) {
        map.set(String(id), provider);
      }
    });

    return map;
  }, [providers]);

  const selectedProviders = useMemo(() => {
    return selectedProviderIds.map(id => providerMap.get(String(id))).filter(Boolean);
  }, [selectedProviderIds, providerMap]);

  const toggleProviderSelection = (providerId) => {
    const idStr = String(providerId);
    setSelectedProviderIds((prev) => {
      if (prev.includes(idStr)) {
        return prev.filter(id => id !== idStr);
      } else if (prev.length < 3) {
        return [...prev, idStr];
      }
      return prev;
    });
  };

  const addAvailabilitySlot = () => {
    if (!slotDate || !slotStart || !slotEnd) {
      setError('Please complete date, start time, and end time before adding a slot.');
      return;
    }

    if (slotEnd <= slotStart) {
      setError('End time must be later than start time.');
      return;
    }

    setError('');
    setAvailabilitySlots((prev) => [
      ...prev,
      {
        id: `${slotDate}-${slotStart}-${slotEnd}-${prev.length}`,
        date: slotDate,
        start: slotStart,
        end: slotEnd,
      },
    ]);

    setSlotDate('');
    setSlotStart('');
    setSlotEnd('');
  };

  const removeAvailabilitySlot = (slotId) => {
    setAvailabilitySlots((prev) => prev.filter((slot) => slot.id !== slotId));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!currentUser?.user_id) {
      setError('You must be logged in to submit a request.');
      return;
    }

    if (selectedProviderIds.length === 0) {
      setError('Please select at least one provider before submitting your request.');
      return;
    }

    if (!requestTitle.trim()) {
      setError('Please add a request title.');
      return;
    }

    setIsSubmitting(true);

    try {
      const serializedSlots = availabilitySlots
        .map((slot) => `${slot.date} ${slot.start}-${slot.end}`)
        .join(', ');

      const attachmentSummary = attachments.length > 0
        ? JSON.stringify(
            attachments.map((file) => ({
              name: file.name,
              type: file.type,
              size: file.size,
            }))
          )
        : null;

      const descriptionWithSlots = serializedSlots
        ? `${description}\n\nAvailability: ${serializedSlots}`
        : description;

      const payload = {
        user_id: currentUser.user_id,
        sp_ids: selectedProviderIds.map(id => Number(id)),
        service_name: requestTitle.trim(),
        date_required: dateRequired || availabilitySlots[0]?.date || null,
        urgency,
        description: descriptionWithSlots,
        attachment_url: attachmentSummary,
        work_address: address,
        work_latitude: null,
        work_longitude: null,
      };

      const response = await fetch(buildApiUrl('/api/requests-multi'), {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to submit request right now.'));
      }

      const providerNames = selectedProviders
        .map(p => p?.sp_name || p?.full_name || 'Provider')
        .join(', ');

      const summary = {
        requestId: data.requests?.[0]?.request_id || data.requests?.[0]?.id || null,
        requestTitle: requestTitle.trim(),
        providerName: providerNames,
        preferredDate: dateRequired || availabilitySlots[0]?.date || '',
        urgency,
        description,
        address,
        attachmentCount: attachments.length,
        availabilitySlots,
        providerCount: selectedProviderIds.length,
      };

      setRequestTitle('');
      setDescription('');
      setAddress('');
      setUrgency('Low');
      setDateRequired('');
      setAttachments([]);
      setAvailabilitySlots([]);
      setSlotDate('');
      setSlotStart('');
      setSlotEnd('');
      setSelectedProviderIds([]);
      onSuccess(summary);
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
        <div style={{ marginBottom: '15px' }}>
          <label className="field-label">
            Select providers (up to 3)
          </label>
          <p className="card-sub" style={{ marginBottom: '12px', color: 'var(--ink-700)' }}>
            Choose 1-3 professionals. If one accepts, requests to others will be automatically canceled.
          </p>
          
          {providerLoadError && <p className="auth-error" style={{ marginBottom: '12px' }}>{providerLoadError}</p>}
          
          {!isLoadingProviders && providers.length > 0 && (
            <div style={{ display: 'grid', gap: '10px', marginBottom: '15px' }}>
              {providers.map((provider) => {
                const id = String(provider.sp_id || provider.id);
                const isSelected = selectedProviderIds.includes(id);
                const isDisabled = !isSelected && selectedProviderIds.length >= 3;
                const name = provider.sp_name || provider.full_name || 'Professional';
                const specialization = provider.specialization || provider.service_type || 'General Services';

                return (
                  <label
                    key={id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '12px',
                      border: `2px solid ${isSelected ? 'var(--accent-ocean)' : 'var(--line-soft)'}`,
                      backgroundColor: isSelected ? '#f0f6fa' : 'transparent',
                      borderRadius: '8px',
                      cursor: isDisabled ? 'not-allowed' : 'pointer',
                      opacity: isDisabled ? 0.6 : 1,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleProviderSelection(id)}
                      disabled={isDisabled}
                      style={{ marginRight: '10px', cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                    />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 4px 0', fontWeight: 500, color: 'var(--ink-900)' }}>{name}</p>
                      <p style={{ margin: 0, fontSize: '13px', color: 'var(--ink-500)' }}>
                        {specialization} • ${provider.hourly_charge || provider.hourly_rate}/hr
                      </p>
                    </div>
                  </label>
                );
              })}
            </div>
          )}

          {selectedProviders.length > 0 && (
            <div style={{ marginBottom: '15px', padding: '12px', backgroundColor: '#f8fbff', borderRadius: '8px', border: '1px solid #b3deff' }}>
              <p className="card-sub" style={{ margin: '0 0 10px 0', color: 'var(--ink-900)' }}>
                Selected: {selectedProviders.length}/3
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {selectedProviders.map((provider) => (
                  <div
                    key={provider.sp_id || provider.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 12px',
                      backgroundColor: 'white',
                      border: '1px solid var(--accent-ocean)',
                      borderRadius: '16px',
                      fontSize: '13px',
                      color: 'var(--accent-ocean)',
                    }}
                  >
                    <span>{provider.sp_name || provider.full_name}</span>
                    <button
                      type="button"
                      onClick={() => toggleProviderSelection(provider.sp_id || provider.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--accent-ocean)',
                        cursor: 'pointer',
                        fontSize: '16px',
                        padding: '0',
                        lineHeight: '1',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label" htmlFor="request-title">
            Request title
          </label>
          <input
            id="request-title"
            type="text"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            placeholder="Example: Kitchen sink leak"
            value={requestTitle}
            onChange={(e) => setRequestTitle(e.target.value)}
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
          <label className="field-label" htmlFor="request-date">
            Preferred date
          </label>
          <input
            id="request-date"
            type="date"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            value={dateRequired}
            onChange={(e) => setDateRequired(e.target.value)}
          />
        </div>

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label" htmlFor="request-address">
            Service address
          </label>
          <input
            id="request-address"
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
          <label className="field-label" htmlFor="urgency-level">
            Urgency Level
          </label>
          <select 
            id="urgency-level"
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

        <div style={{ marginBottom: '15px' }}>
          <label className="field-label" htmlFor="attachments">
            Upload pictures or videos
          </label>
          <input
            id="attachments"
            type="file"
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
            accept="image/*,video/*"
            multiple
            onChange={(e) => setAttachments(Array.from(e.target.files || []))}
          />
          {attachments.length > 0 && (
            <p className="card-sub" style={{ marginTop: '8px' }}>
              {attachments.length} file(s) attached.
            </p>
          )}
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label className="field-label">Custom availability slots</label>
          <div className="card" style={{ marginBottom: '10px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', alignItems: 'end' }}>
              <div>
                <label className="field-label" htmlFor="slot-date">Date</label>
                <input
                  id="slot-date"
                  type="date"
                  className="input-field"
                  style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
                  value={slotDate}
                  onChange={(e) => setSlotDate(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="slot-start">Start</label>
                <input
                  id="slot-start"
                  type="time"
                  className="input-field"
                  style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
                  value={slotStart}
                  onChange={(e) => setSlotStart(e.target.value)}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="slot-end">End</label>
                <input
                  id="slot-end"
                  type="time"
                  className="input-field"
                  style={{ width: '100%', padding: '10px', borderRadius: '10px' }}
                  value={slotEnd}
                  onChange={(e) => setSlotEnd(e.target.value)}
                />
              </div>
              <button type="button" className="btn-s" onClick={addAvailabilitySlot}>Add Slot</button>
            </div>
          </div>

          {availabilitySlots.length > 0 && (
            <div style={{ display: 'grid', gap: '8px' }}>
              {availabilitySlots.map((slot) => (
                <div key={slot.id} className="provider-highlight" style={{ marginBottom: 0 }}>
                  <p className="provider-highlight-sub">
                    {slot.date} | {slot.start} - {slot.end}
                  </p>
                  <button
                    type="button"
                    className="auth-switch-btn"
                    onClick={() => removeAvailabilitySlot(slot.id)}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="auth-error" style={{ marginBottom: '12px' }}>{error}</p>}

        <div className="form-actions">
          <button type="button" className="btn-s" onClick={onBack}>
            Back to Home
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