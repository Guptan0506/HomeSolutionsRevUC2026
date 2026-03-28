import React from 'react';

function ProviderCard({ name, type, price, experience, initials, onSelect }) {
  return (
    <div className="card">
      <div className="card-head">
        <div className="avt avt-blue">{initials}</div>
        <div style={{ flex: 1 }}>
          <div className="card-name">{name}</div>
          <div className="card-sub" style={{ fontSize: '11px', color: '#666' }}>
            {type} • {experience} yrs exp.
          </div>
        </div>
        <div className="card-price">${price}/hr</div>
      </div>
      <button 
        className="btn-p" 
        style={{ width: '100%', marginTop: '12px' }}
        onClick={onSelect}
      >
        Select Professional
      </button>
    </div>
  );
}

export default ProviderCard;