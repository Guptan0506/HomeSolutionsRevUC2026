import React, { useMemo, useState } from 'react';
import MessagingPanel from './MessagingPanel';
import { useUnreadMessages } from '../hooks/useUnreadMessages';

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function formatDateTime(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function getInitial(name) {
  return (name || 'C').trim().charAt(0).toUpperCase();
}

function ServiceProviderProfilePage({
  currentUser,
  serviceRequests,
  onProfileSave,
  onRequestUpdate,
  onViewInvoice,
}) {
  const [photo, setPhoto] = useState(currentUser.profile_photo || '');
  const [name, setName] = useState(currentUser.full_name || '');
  const [contact, setContact] = useState(currentUser.phone || currentUser.email || '');
  const [location, setLocation] = useState(currentUser.location || '');
  const [expertise, setExpertise] = useState(currentUser.specialization || '');
  const [servicesOffered, setServicesOffered] = useState(currentUser.services || currentUser.sp_services || currentUser.specialization || '');
  const [availability, setAvailability] = useState(currentUser.availability || '');
  const [experience, setExperience] = useState(currentUser.experience_years || '');
  const [baseRate, setBaseRate] = useState(currentUser.base_rate || currentUser.hourly_charge || '');
  const [saveMessage, setSaveMessage] = useState('');

  const [activeAcceptRequestId, setActiveAcceptRequestId] = useState(null);
  const [estimatedTime, setEstimatedTime] = useState('');
  const [possibleMaterialsNeeded, setPossibleMaterialsNeeded] = useState('');
  const [eta, setEta] = useState('');

  const [activeCompleteRequestId, setActiveCompleteRequestId] = useState(null);
  const [extraMaterialsUsed, setExtraMaterialsUsed] = useState('');
  const [hoursWorked, setHoursWorked] = useState('');
  const [extraMaterialsCost, setExtraMaterialsCost] = useState('');
  const [extraFee, setExtraFee] = useState('');
  const [messagingRequestId, setMessagingRequestId] = useState(null);
  const [messagingCustomerName, setMessagingCustomerName] = useState('');

  // Fetch unread message counts
  const { unreadCounts } = useUnreadMessages(currentUser?.user_id, true);

  const servicesProvided = useMemo(
    () => serviceRequests.filter((request) => request.status === 'completed'),
    [serviceRequests]
  );
  const activeAcceptRequest = useMemo(
    () => serviceRequests.find((request) => request.requestId === activeAcceptRequestId) || null,
    [serviceRequests, activeAcceptRequestId]
  );
  const activeCompleteRequest = useMemo(
    () => serviceRequests.find((request) => request.requestId === activeCompleteRequestId) || null,
    [serviceRequests, activeCompleteRequestId]
  );

  const displayPhoto = useMemo(() => {
    if (photo) {
      return photo;
    }

    return `https://ui-avatars.com/api/?background=0f6e8c&color=fff&name=${encodeURIComponent(name || 'Provider')}`;
  }, [photo, name]);

  const handlePhotoUpload = (event) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  };

  const handleSaveAbout = () => {
    onProfileSave({
      ...currentUser,
      full_name: name,
      phone: contact,
      location,
      specialization: expertise,
      services: servicesOffered,
      availability,
      experience_years: experience,
      base_rate: baseRate,
      profile_photo: photo,
    });

    setSaveMessage('About section updated.');
    window.setTimeout(() => setSaveMessage(''), 2000);
  };

  const handleOpenAccept = (requestId) => {
    setActiveAcceptRequestId(requestId);
    setEstimatedTime('');
    setPossibleMaterialsNeeded('');
    setEta('');
  };

  const handleSubmitAccept = () => {
    if (!activeAcceptRequestId) {
      return;
    }

    onRequestUpdate(activeAcceptRequestId, {
      status: 'in_progress',
      estimatedTime,
      possibleMaterialsNeeded,
      eta,
      baseRatePerHour: Number(baseRate || 0),
      amountReceived: 0,
    });

    setActiveAcceptRequestId(null);
  };

  const handleDecline = (requestId) => {
    onRequestUpdate(requestId, {
      status: 'rejected',
      amountReceived: 0,
    });
  };

  const handleOpenComplete = (requestId) => {
    setActiveCompleteRequestId(requestId);
    setExtraMaterialsUsed('');
    setHoursWorked('');
    setExtraMaterialsCost('');
    setExtraFee('');
  };

  const handleSubmitComplete = () => {
    if (!activeCompleteRequestId) {
      return;
    }

    const targetRequest = serviceRequests.find((request) => request.requestId === activeCompleteRequestId);
    const baseRatePerHour = Number(targetRequest?.baseRatePerHour || baseRate || 0);
    const workedHours = Number(hoursWorked || 0);
    const materialCost = Number(extraMaterialsCost || 0);
    const urgentExtraFee = Number(extraFee || 0);
    const subtotal = baseRatePerHour * workedHours + materialCost + urgentExtraFee;
    const tax = subtotal * 0.07;
    const commission = subtotal * 0.05;
    const total = subtotal + tax + commission;

    onRequestUpdate(activeCompleteRequestId, {
      status: 'completed',
      materialsUsed: extraMaterialsUsed,
      hoursWorked: workedHours,
      extraMaterialsCost: materialCost,
      extraFee: urgentExtraFee,
      baseRatePerHour,
      subtotal,
      tax,
      commission,
      total,
      amountReceived: total,
      completionAt: new Date().toISOString(),
    });

    setActiveCompleteRequestId(null);
  };

  return (
    <section className="section-wrap service-provider-wrap">
      <div className="sec-label">Service Provider Profile</div>

      <div className="card provider-about-card">
        <p className="provider-about-title">About</p>

        <div className="provider-about-grid">
          <div className="provider-photo-col">
            <img src={displayPhoto} alt="Service provider" className="provider-avatar" />
            <label htmlFor="provider-photo-upload" className="btn-s upload-photo-btn">Upload Photo</label>
            <input
              id="provider-photo-upload"
              type="file"
              accept="image/*"
              onChange={handlePhotoUpload}
              style={{ display: 'none' }}
            />
          </div>

          <div className="provider-fields-col">
            <label className="field-label" htmlFor="provider-name">Name</label>
            <input id="provider-name" className="input-field profile-input" value={name} onChange={(e) => setName(e.target.value)} />

            <label className="field-label" htmlFor="provider-contact">Contact</label>
            <input id="provider-contact" className="input-field profile-input" value={contact} onChange={(e) => setContact(e.target.value)} />

            <label className="field-label" htmlFor="provider-location">Location</label>
            <input id="provider-location" className="input-field profile-input" value={location} onChange={(e) => setLocation(e.target.value)} />

            <label className="field-label" htmlFor="provider-expertise">Expertise</label>
            <input id="provider-expertise" className="input-field profile-input" value={expertise} onChange={(e) => setExpertise(e.target.value)} />

            <label className="field-label" htmlFor="provider-services">Work / Services Offered</label>
            <input
              id="provider-services"
              className="input-field profile-input"
              value={servicesOffered}
              onChange={(e) => setServicesOffered(e.target.value)}
              placeholder="e.g., Wiring, Switch Repair, Circuit Breakers"
            />

            <label className="field-label" htmlFor="provider-availability">Availability (Required to appear in provider list)</label>
            <textarea
              id="provider-availability"
              className="input-field profile-input"
              rows="3"
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="e.g., Mon-Fri 9am-6pm, Saturday 10am-2pm"
            />

            <label className="field-label" htmlFor="provider-experience">Experiences (Years)</label>
            <input id="provider-experience" className="input-field profile-input" value={experience} onChange={(e) => setExperience(e.target.value)} />

            <label className="field-label" htmlFor="provider-base-rate">Base Rate</label>
            <input id="provider-base-rate" className="input-field profile-input" value={baseRate} onChange={(e) => setBaseRate(e.target.value)} />

            <div className="profile-editor-actions">
              <button type="button" className="btn-p" onClick={handleSaveAbout}>Save About</button>
              {saveMessage && <p className="profile-save-message">{saveMessage}</p>}
            </div>
          </div>
        </div>
      </div>

      <div className="sec-label" style={{ marginTop: '14px' }}>Service Requests</div>
      <div className="provider-request-grid">
        {serviceRequests.map((request) => (
          <article className="card provider-request-card" key={request.requestId}>
            <div className="history-card-head">
              <div className="request-customer-head">
                {request.customerPhoto ? (
                  <img src={request.customerPhoto} alt={request.customerName} className="request-customer-avatar" />
                ) : (
                  <div className="request-customer-avatar request-customer-avatar-fallback">{getInitial(request.customerName)}</div>
                )}
                <p className="history-id">Request #{request.requestId}</p>
              </div>
              <span className={`history-status ${request.status}`}>{request.status.replace('_', ' ')}</span>
            </div>

            <p className="history-line"><strong>Customer Name:</strong> {request.customerName}</p>
            <p className="history-line"><strong>Contact:</strong> {request.contact}</p>
            <p className="history-line"><strong>Request Title:</strong> {request.requestTitle}</p>
            <p className="history-line"><strong>Description:</strong> {request.requestDescription}</p>
            <p className="history-line"><strong>Date and Time Requested:</strong> {formatDateTime(request.requestedAt)}</p>

            <div className="provider-request-actions">
              <button
                type="button"
                className="btn-s"
                onClick={() => {
                  setMessagingRequestId(request.requestId);
                  setMessagingCustomerName(request.customerName);
                }}
                style={{ marginRight: '8px', position: 'relative' }}
              >
                Message
                {unreadCounts[request.requestId] > 0 && (
                  <span className="notification-badge">{unreadCounts[request.requestId]}</span>
                )}
              </button>
              {request.status === 'pending' && (
                <>
                  <button type="button" className="btn-p" onClick={() => handleOpenAccept(request.requestId)}>Accept</button>
                  <button type="button" className="btn-s" onClick={() => handleDecline(request.requestId)}>Decline</button>
                </>
              )}

              {request.status === 'in_progress' && (
                <button type="button" className="btn-p" onClick={() => handleOpenComplete(request.requestId)}>Complete</button>
              )}

              {request.status === 'completed' && (
                <button type="button" className="btn-s" onClick={() => onViewInvoice(request)}>View Invoice</button>
              )}
            </div>
          </article>
        ))}
      </div>

      <div className="sec-label" style={{ marginTop: '14px' }}>Services Provided</div>
      <div className="provider-request-grid">
        {servicesProvided.length === 0 && (
          <div className="state-card">
            <p className="state-title">No completed services yet</p>
            <p className="state-copy">Completed jobs will appear here with amount and materials used.</p>
          </div>
        )}

        {servicesProvided.map((request) => (
          <article className="card provider-request-card" key={`completed-${request.requestId}`}>
            <div className="request-customer-head">
              {request.customerPhoto ? (
                <img src={request.customerPhoto} alt={request.customerName} className="request-customer-avatar" />
              ) : (
                <div className="request-customer-avatar request-customer-avatar-fallback">{getInitial(request.customerName)}</div>
              )}
              <p className="history-id">Request #{request.requestId}</p>
            </div>
            <p className="history-line"><strong>Customer Name:</strong> {request.customerName}</p>
            <p className="history-line"><strong>Location:</strong> {request.location}</p>
            <p className="history-line"><strong>Description:</strong> {request.requestDescription}</p>
            <p className="history-line"><strong>Date and Time:</strong> {formatDateTime(request.requestedAt)}</p>
            <p className="history-line"><strong>Amount Received:</strong> {formatMoney(request.amountReceived)}</p>
            <p className="history-line"><strong>Materials Used (Optional):</strong> {request.materialsUsed || 'None noted'}</p>
            <button type="button" className="btn-s" onClick={() => onViewInvoice(request)}>View Invoice</button>
          </article>
        ))}
      </div>

      {activeAcceptRequestId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Accept request details">
          <div className="modal-card">
            <p className="modal-title">Accept Request</p>

            {activeAcceptRequest && (
              <div className="modal-customer-summary">
                {activeAcceptRequest.customerPhoto ? (
                  <img
                    src={activeAcceptRequest.customerPhoto}
                    alt={activeAcceptRequest.customerName}
                    className="request-customer-avatar"
                  />
                ) : (
                  <div className="request-customer-avatar request-customer-avatar-fallback">
                    {getInitial(activeAcceptRequest.customerName)}
                  </div>
                )}
                <div>
                  <p className="modal-customer-name">{activeAcceptRequest.customerName}</p>
                  <p className="modal-customer-sub">{activeAcceptRequest.requestTitle}</p>
                </div>
              </div>
            )}

            <label className="field-label" htmlFor="accept-estimated-time">Estimated Time</label>
            <input
              id="accept-estimated-time"
              className="input-field profile-input"
              placeholder="2 hours"
              value={estimatedTime}
              onChange={(e) => setEstimatedTime(e.target.value)}
            />

            <label className="field-label" htmlFor="accept-materials">Possible Materials Needed</label>
            <textarea
              id="accept-materials"
              className="input-field profile-input"
              rows="3"
              placeholder="Pipe sealant, wrench set"
              value={possibleMaterialsNeeded}
              onChange={(e) => setPossibleMaterialsNeeded(e.target.value)}
            />

            <label className="field-label" htmlFor="accept-eta">ETA</label>
            <input
              id="accept-eta"
              className="input-field profile-input"
              placeholder="Today by 6:00 PM"
              value={eta}
              onChange={(e) => setEta(e.target.value)}
            />

            <div className="form-actions">
              <button type="button" className="btn-s" onClick={() => setActiveAcceptRequestId(null)}>Cancel</button>
              <button type="button" className="btn-p" onClick={handleSubmitAccept}>Submit</button>
            </div>
          </div>
        </div>
      )}

      {activeCompleteRequestId && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Complete request details">
          <div className="modal-card">
            <p className="modal-title">Complete Request</p>

            {activeCompleteRequest && (
              <div className="modal-customer-summary">
                {activeCompleteRequest.customerPhoto ? (
                  <img
                    src={activeCompleteRequest.customerPhoto}
                    alt={activeCompleteRequest.customerName}
                    className="request-customer-avatar"
                  />
                ) : (
                  <div className="request-customer-avatar request-customer-avatar-fallback">
                    {getInitial(activeCompleteRequest.customerName)}
                  </div>
                )}
                <div>
                  <p className="modal-customer-name">{activeCompleteRequest.customerName}</p>
                  <p className="modal-customer-sub">{activeCompleteRequest.requestTitle}</p>
                </div>
              </div>
            )}

            <label className="field-label" htmlFor="complete-materials">Extra Materials Used</label>
            <textarea
              id="complete-materials"
              className="input-field profile-input"
              rows="3"
              placeholder="Added drain hose"
              value={extraMaterialsUsed}
              onChange={(e) => setExtraMaterialsUsed(e.target.value)}
            />

            <label className="field-label" htmlFor="complete-time">Hours Worked</label>
            <input
              id="complete-time"
              className="input-field profile-input"
              type="number"
              min="0"
              step="0.25"
              placeholder="2.5"
              value={hoursWorked}
              onChange={(e) => setHoursWorked(e.target.value)}
            />

            <label className="field-label" htmlFor="complete-material-cost">Cost of Extra Materials Used</label>
            <input
              id="complete-material-cost"
              className="input-field profile-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={extraMaterialsCost}
              onChange={(e) => setExtraMaterialsCost(e.target.value)}
            />

            <label className="field-label" htmlFor="complete-extra-fee">Extra Fee (Urgent, Optional)</label>
            <input
              id="complete-extra-fee"
              className="input-field profile-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={extraFee}
              onChange={(e) => setExtraFee(e.target.value)}
            />

            <div className="form-actions">
              <button type="button" className="btn-s" onClick={() => setActiveCompleteRequestId(null)}>Cancel</button>
              <button type="button" className="btn-p" onClick={handleSubmitComplete}>Complete</button>
            </div>
          </div>
        </div>
      )}

      {messagingRequestId && (
        <div style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(90vw, 500px)',
          height: 'min(90vh, 600px)',
          zIndex: 1000,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <div style={{ width: '100%', height: '100%' }}>
            <MessagingPanel
              requestId={messagingRequestId}
              currentUser={currentUser}
              otherPartyName={messagingCustomerName}
              onClose={() => {
                setMessagingRequestId(null);
                setMessagingCustomerName('');
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}

export default ServiceProviderProfilePage;
