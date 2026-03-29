import React, { useState, useEffect } from 'react';
import ProviderCard from './ProviderCard';
import { buildApiUrl } from '../api';

function ProvidersList({ onSelect }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const getProviders = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/providers'));

        if (!response.ok) {
          throw new Error('Failed to fetch providers');
        }

        const data = await response.json();
        setProviders(data);
        setLoading(false);
      } catch (err) {
        console.error('Fetch error:', err);
        setError('Could not connect to the service database. Please make sure backend is running.');
        setLoading(false);
      }
    };

    getProviders();
  }, []);

  if (loading) {
    return (
      <div className="state-card">
        <p className="state-title">Finding trusted professionals...</p>
        <p className="state-copy">Checking who is available in your area right now.</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="state-card error">
        <p className="state-title">Connection issue</p>
        <p className="state-copy">{error}</p>
      </div>
    );
  }

  return (
    <div className="section-wrap">
      <div className="sec-label">Available Professionals</div>

      {Array.isArray(providers) && providers.length > 0 ? (
        providers.map((pro) => {
          const providerName = pro.sp_name || pro.full_name || 'Professional';
          const providerType = pro.specialization || pro.service_type || 'General Services';
          const providerPrice = pro.hourly_charge || pro.hourly_rate || '--';
          const providerExperience = pro.experience_years || pro.experience || 'N/A';

          return (
            <ProviderCard
              key={pro.sp_id || pro.id}
              name={providerName}
              type={providerType}
              price={providerPrice}
              experience={providerExperience}
              initials={providerName.charAt(0)}
              onSelect={() => onSelect(pro)}
            />
          );
        })
      ) : (
        <div className="state-card">
          <p className="state-title">No providers found</p>
          <p className="state-copy">Try again soon as more professionals join the network.</p>
        </div>
      )}
    </div>
  );
}

export default ProvidersList;