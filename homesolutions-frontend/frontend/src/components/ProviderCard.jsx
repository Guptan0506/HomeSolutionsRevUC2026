import React from 'react';

function ProviderCard({ name, type, price, experience, initials, onSelect, profilePictureUrl }) {
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
        <span className="pill">Verified Profile</span>
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