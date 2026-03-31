import React, { useMemo, useState } from 'react';

function formatCurrency(amount) {
  const value = Number(amount || 0);
  return `$${value.toFixed(2)}`;
}

function formatDate(dateValue) {
  if (!dateValue) {
    return 'N/A';
  }

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return date.toLocaleDateString();
}

function statusLabel(status) {
  if (status === 'in_progress') {
    return 'In Progress';
  }

  if (status === 'rejected') {
    return 'Rejected';
  }

  if (status === 'completed') {
    return 'Completed';
  }

  return 'In Progress';
}

function CustomerProfilePage({ currentUser, requestHistory, onProfileSave, onRequestUpdate }) {
  const [profilePhoto, setProfilePhoto] = useState(currentUser.profile_photo || '');
  const [fullName, setFullName] = useState(currentUser.full_name || '');
  const [email, setEmail] = useState(currentUser.email || '');
  const [phone, setPhone] = useState(currentUser.phone || '');
  const [location, setLocation] = useState(currentUser.location || '');
  const [saveMessage, setSaveMessage] = useState('');

  const displayPhoto = useMemo(() => {
    if (profilePhoto) {
      return profilePhoto;
    }

    return `https://ui-avatars.com/api/?background=0f6e8c&color=fff&name=${encodeURIComponent(fullName || 'User')}`;
  }, [profilePhoto, fullName]);

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setProfilePhoto(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = () => {
    onProfileSave({
      ...currentUser,
      full_name: fullName,
      email,
      phone,
      location,
      profile_photo: profilePhoto,
    });
    setSaveMessage('Profile updated successfully.');
    window.setTimeout(() => setSaveMessage(''), 2200);
  };

  const handlePaymentMethodSave = (requestId) => {
    onRequestUpdate(requestId, { paymentMethodSaved: true });
  };

  const handlePaymentMethodChange = (requestId, value) => {
    onRequestUpdate(requestId, { paymentMethod: value, paymentMethodSaved: false });
  };

  const handleRating = (requestId, rating) => {
    onRequestUpdate(requestId, { rating });
  };

  return (
    <section className="section-wrap customer-profile-wrap">
      <div className="sec-label">Customer Profile</div>

      <div className="card profile-editor-card">
        <p className="profile-editor-title">Your Profile</p>

        <div className="profile-editor-grid">
          <div className="profile-photo-col">
            <img src={displayPhoto} alt="Profile" className="profile-avatar" />
            <label className="btn-s upload-photo-btn" htmlFor="profile-photo-input">
              Upload Photo
            </label>
            <input
              id="profile-photo-input"
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              style={{ display: 'none' }}
            />
          </div>

          <div className="profile-fields-col">
            <label className="field-label" htmlFor="customer-name">Name</label>
            <input
              id="customer-name"
              className="input-field profile-input"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />

            <label className="field-label" htmlFor="customer-email">Email</label>
            <input
              id="customer-email"
              className="input-field profile-input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />

            <label className="field-label" htmlFor="customer-phone">Phone</label>
            <input
              id="customer-phone"
              className="input-field profile-input"
              type="tel"
              placeholder="(555) 000-0000"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />

            <label className="field-label" htmlFor="customer-location">Your Area / Location</label>
            <input
              id="customer-location"
              className="input-field profile-input"
              type="text"
              placeholder="e.g., Downtown, Westside"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />

            <div className="profile-editor-actions">
              <button type="button" className="btn-p" onClick={handleSaveProfile}>Save Profile</button>
              {saveMessage && <p className="profile-save-message">{saveMessage}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="sec-label" style={{ marginTop: '12px' }}>Request History</div>
      <div className="history-scroll-row">
        {requestHistory.map((request) => {
          const cardStatus = statusLabel(request.status);
          const amount = request.status === 'rejected' ? 0 : Number(request.amount || 0);

          return (
            <article className="card history-card" key={request.requestId}>
              <div className="history-card-head">
                <p className="history-id">Request #{request.requestId}</p>
                <span className={`history-status ${request.status}`}>{cardStatus}</span>
              </div>

              <p className="history-line"><strong>Date Requested:</strong> {formatDate(request.dateRequested)}</p>
              <p className="history-line"><strong>Assigned Provider:</strong> {request.providerName}</p>
              <p className="history-line"><strong>Amount:</strong> {formatCurrency(amount)}</p>

              {request.status === 'in_progress' && (
                <div className="history-in-progress">
                  <p className="history-line"><strong>Provider Estimate:</strong> {formatCurrency(request.estimate || 0)}</p>
                  <label className="field-label" htmlFor={`payment-method-${request.requestId}`}>Payment Method</label>
                  <input
                    id={`payment-method-${request.requestId}`}
                    className="input-field profile-input"
                    type="text"
                    placeholder="Card ending in 4242"
                    value={request.paymentMethod || ''}
                    onChange={(e) => handlePaymentMethodChange(request.requestId, e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn-s"
                    style={{ marginTop: '8px' }}
                    onClick={() => handlePaymentMethodSave(request.requestId)}
                  >
                    {request.paymentMethodSaved ? 'Payment Method Added' : 'Add Payment Method'}
                  </button>
                </div>
              )}

              {request.status === 'completed' && (
                <div className="history-rating-wrap">
                  <p className="field-label" style={{ marginBottom: '8px' }}>Rate Service Provider</p>
                  <div className="rating-row" role="radiogroup" aria-label="Rate provider">
                    {[1, 2, 3, 4, 5].map((value) => (
                      <button
                        type="button"
                        key={`${request.requestId}-star-${value}`}
                        className={`star-btn ${value <= (request.rating || 0) ? 'active' : ''}`}
                        onClick={() => handleRating(request.requestId, value)}
                        aria-label={`Rate ${value} stars`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default CustomerProfilePage;
