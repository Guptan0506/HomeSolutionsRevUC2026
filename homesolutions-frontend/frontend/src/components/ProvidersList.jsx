import React, { useState, useEffect } from 'react';
import ProviderCard from './ProviderCard';

function ProvidersList({ onSelect }) {
  // 1. Create a "state" to hold our list of providers
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 2. The useEffect hook runs automatically when the component appears
  useEffect(() => {
    const getProviders = async () => {
      try {
        // This is the URL of your Node.js server
        const response = await fetch('http://localhost:5000/api/providers');
        
        if (!response.ok) {
          throw new Error('Failed to fetch providers');
        }

        const data = await response.json();
        setProviders(data); // Save the Postgres data into our state
        setLoading(false);
      } catch (err) {
        console.error("Fetch error:", err);
        setError("Could not connect to the service database.");
        setLoading(false);
      }
    };

    getProviders();
  }, []); // [] ensures this only runs once

  // 3. Handle Loading and Error states
  if (loading) return <div className="section-wrap">Finding local pros...</div>;
  if (error) return <div className="section-wrap" style={{ color: 'red' }}>{error}</div>;

return (
    <div className="section-wrap">
      <div className="sec-label">Available Professionals</div>
      
      {/* 1. We check if providers is an array and has items */}
      {Array.isArray(providers) && providers.length > 0 ? (
        
        /* 2. If yes, we loop through them */
        providers.map((pro) => (
          <ProviderCard 
            key={pro.id} 
            name={pro.full_name} 
            type={pro.service_type} 
            price={pro.hourly_rate}
            experience={pro.experience_years}
            initials={pro.full_name ? pro.full_name.charAt(0) : 'P'}
            onSelect={() => onSelect(pro)} 
          />
        ))
      ) : (
        /* 3. If no, we show this message */
        <p>No providers available or loading...</p>
      )}
    </div>
  );
}

export default ProvidersList; 