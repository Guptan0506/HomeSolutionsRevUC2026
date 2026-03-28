import React, { useState } from 'react';

function RequestForm({ onSuccess }) {
  const [description, setDescription] = useState('');
  const [urgency, setUrgency] = useState('Low');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // In the future, this is where we will 'fetch' to your Node.js backend
    console.log("Submitting:", { description, urgency });
    
    alert("Request submitted successfully!");
    onSuccess(); // This takes the user back to the Home screen
  };

  return (
    <div className="section-wrap">
      <div className="sec-label">Request Service</div>
      
      <form onSubmit={handleSubmit} className="card" style={{ padding: '20px' }}>
        <div style={{ marginBottom: '15px' }}>
          <label style={{ fontSize: '12px', display: 'block', marginBottom: '5px' }}>
            What do you need help with?
          </label>
          <textarea 
            className="input-field"
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
            rows="4"
            placeholder="Describe the issue (e.g., Leaking faucet in kitchen)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ fontSize: '12px', display: 'block', marginBottom: '5px' }}>
            Urgency Level
          </label>
          <select 
            style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid #ddd' }}
            value={urgency}
            onChange={(e) => setUrgency(e.target.value)}
          >
            <option value="Low">Low (Can wait a few days)</option>
            <option value="Medium">Medium (Next 24 hours)</option>
            <option value="High">High (Emergency - ASAP)</option>
          </select>
        </div>

        <button type="submit" className="btn-p" style={{ width: '100%' }}>
          Send Request
        </button>
      </form>
    </div>
  );
}

export default RequestForm;