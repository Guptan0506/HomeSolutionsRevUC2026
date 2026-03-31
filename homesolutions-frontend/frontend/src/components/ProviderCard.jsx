import React from 'react';

function ProviderCard({
  name,
  type,
  price,
  experience,
  distance,
  rating,
  verificationStatus,
  trustScore,
  badgeLevel,
  initials,
  onSelect,
  profilePictureUrl,
}) {
  return (
    <div className="card">
      <div className="card-head">
        {profilePictureUrl ? (
          <img 
            src={profilePictureUrl} 
            alt={name}
            className="avt"
            style={{ width: '48px', height: '48px', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          <div className="avt avt-blue">{initials}</div>
        )}
        <div style={{ flex: 1 }}>
          <div className="card-name">{name}</div>
          <div className="card-sub">
            {type} specialist
          </div>
        </div>
        <div className="card-price">${price}/hr</div>
      </div>

      <div className="card-meta">
        <span className="pill">{experience} years experience</span>
        {distance && <span className="pill location-pill">📍 {distance}</span>}
        {rating && <span className="pill rating-pill">{rating}</span>}
        {verificationStatus === 'verified' ? (
          <span className="pill trust-pill">Verified Profile</span>
        ) : (
          <span className="pill">Unverified</span>
        )}
        {Number(trustScore || 0) > 0 && (
          <span className="pill trust-score-pill">Trust {Number(trustScore).toFixed(0)}</span>
        )}
        {badgeLevel && badgeLevel !== 'new' && (
          <span className="pill badge-level-pill">{badgeLevel.replace('_', ' ')}</span>
        )}
      </div>

      <button 
        className="btn-p" 
        style={{ width: '100%', marginTop: '14px' }}
        onClick={onSelect}
      >
        Book This Professional
      </button>
    </div>
  );
}

export default ProviderCard;