import React from 'react';

function ProviderCard({ name, type, price, experience, initials, onSelect }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="avt avt-blue">{initials}</div>
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