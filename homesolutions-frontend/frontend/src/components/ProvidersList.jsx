import React, { useState, useEffect } from 'react';
import ProviderCard from './ProviderCard';
import { buildApiUrl } from '../api';

function ProvidersList({ onSelect }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [useGeolocation, setUseGeolocation] = useState(true);
  const [distanceFilter, setDistanceFilter] = useState(50);
  const [serviceTypeFilter, setServiceTypeFilter] = useState('');

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setLoading(true);
        setError(null);

        // Try to get user's location
        if (useGeolocation && navigator.geolocation) {
          navigator.geolocation.getCurrentPosition(
            async (position) => {
              const { latitude, longitude } = position.coords;
              setUserLocation({ latitude, longitude });
              await searchNearby(latitude, longitude);
            },
            async () => {
              console.log('Geolocation denied, fetching all providers');
              await fetchAllProviders();
            }
          );
        } else {
          await fetchAllProviders();
        }
      } catch (err) {
        console.error('Fetch error:', err);
        setError('Could not connect to the service database. Please make sure backend is running.');
        setLoading(false);
      }
    };

    fetchProviders();
  }, [useGeolocation]);

  const searchNearby = async (latitude, longitude) => {
    try {
      const params = new URLSearchParams({
        latitude,
        longitude,
        distance: distanceFilter,
        ...(serviceTypeFilter && { serviceType: serviceTypeFilter }),
      });

      const response = await fetch(buildApiUrl(`/api/providers/search/near?${params}`));

      if (!response.ok) {
        throw new Error('Failed to search nearby providers');
      }

      const data = await response.json();
      setProviders(data.providers || []);
      setLoading(false);
    } catch (err) {
      console.error('Search error:', err);
      setError('Failed to search nearby providers');
      setLoading(false);
    }
  };

  const fetchAllProviders = async () => {
    try {
      const response = await fetch(buildApiUrl('/api/providers'));

      if (!response.ok) {
        throw new Error('Failed to fetch providers');
      }

      const data = await response.json();
      setProviders(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (err) {
      console.error('Fetch error:', err);
      setError('Could not connect to the service database.');
      setLoading(false);
    }
  };

  const handleFilterChange = async () => {
    if (userLocation) {
      await searchNearby(userLocation.latitude, userLocation.longitude);
    } else {
      await fetchAllProviders();
    }
  };

  if (loading) {
    return (
      <div className="state-card">
        <p className="state-title">Finding trusted professionals...</p>
        <p className="state-copy">
          {userLocation 
            ? 'Searching for professionals near you.' 
            : 'Checking who is available in your area right now.'}
        </p>
      </div>
    );
  }

  return (
    <div className="section-wrap">
      <div className="sec-label">Available Professionals</div>

      {/* Location and Filter Controls */}
      <div className="providers-filters">
        {userLocation && (
          <div className="location-badge">
            📍 Your Location ({userLocation.latitude.toFixed(2)}, {userLocation.longitude.toFixed(2)})
          </div>
        )}

        <div className="filter-group">
          <label htmlFor="distance-filter">Distance:</label>
          <select
            id="distance-filter"
            value={distanceFilter}
            onChange={(e) => {
              setDistanceFilter(parseInt(e.target.value));
              handleFilterChange();
            }}
            className="filter-select"
          >
            <option value="5">Within 5 miles</option>
            <option value="10">Within 10 miles</option>
            <option value="25">Within 25 miles</option>
            <option value="50">Within 50 miles</option>
            <option value="100">Within 100 miles</option>
            <option value="999">Any distance</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="service-filter">Service Type:</label>
          <input
            id="service-filter"
            type="text"
            placeholder="e.g., Plumbing, Electrical"
            value={serviceTypeFilter}
            onChange={(e) => setServiceTypeFilter(e.target.value)}
            className="filter-input"
          />
          <button
            className="btn-s"
            onClick={handleFilterChange}
            style={{ marginLeft: '8px' }}
          >
            Search
          </button>
        </div>

        {!userLocation && (
          <button
            className="btn-s"
            onClick={() => setUseGeolocation(true)}
            style={{ marginLeft: '8px' }}
          >
            📍 Use My Location
          </button>
        )}
      </div>

      {error && (
        <div className="state-card error">
          <p className="state-title">Error</p>
          <p className="state-copy">{error}</p>
        </div>
      )}

      {Array.isArray(providers) && providers.length > 0 ? (
        <div>
          <p className="filter-result-count">
            Found {providers.length} professional{providers.length !== 1 ? 's' : ''}
            {userLocation && ` near you`}
          </p>
          {providers.map((pro) => {
            const providerName = pro.sp_name || pro.full_name || 'Professional';
            const providerType = pro.specialization || pro.service_type || 'General Services';
            const providerPrice = pro.hourly_charge || pro.hourly_rate || '--';
            const providerExperience = pro.experience_years || pro.experience || 'N/A';
            const profilePictureUrl = pro.profile_picture_url || null;
            const distance = pro.distance_miles ? `${pro.distance_miles} mi away` : null;
            const rating = pro.average_rating ? `⭐ ${pro.average_rating}` : null;

            return (
              <ProviderCard
                key={pro.sp_id || pro.id}
                name={providerName}
                type={providerType}
                price={providerPrice}
                experience={providerExperience}
                distance={distance}
                rating={rating}
                initials={providerName.charAt(0)}
                profilePictureUrl={profilePictureUrl}
                onSelect={() => onSelect(pro)}
              />
            );
          })}
        </div>
      ) : (
        <div className="state-card">
          <p className="state-title">No providers found</p>
          <p className="state-copy">
            Try adjusting your distance filter or service type search.
          </p>
        </div>
      )}
    </div>
  );
}

export default ProvidersList;