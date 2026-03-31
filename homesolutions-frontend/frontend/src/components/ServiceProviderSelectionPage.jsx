import React, { useEffect, useMemo, useState } from 'react';
import { buildApiUrl, getApiErrorMessage, readJsonSafely } from '../api';

function formatHourlyRate(provider) {
  const value = Number(provider.hourly_charge || provider.hourly_rate || 0);
  return `$${value.toFixed(2)}/hr`;
}

function getExperience(provider) {
  const experience = provider.experience_years || provider.experience || 0;
  return `${experience} years`;
}

function ServiceProviderSelectionPage({ selectedService, customerLocation, onBookNow }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('name'); // 'name', 'rating', 'price', 'experience'
  const [minRating, setMinRating] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const fetchProviders = async () => {
      setLoading(true);
      setError('');

      try {
        if (!customerLocation?.trim()) {
          if (isMounted) {
            setProviders([]);
            setError('Add your location in your profile to see providers in your area.');
            setLoading(false);
          }
          return;
        }

        const query = new URLSearchParams({ location: customerLocation.trim() }).toString();
        const response = await fetch(buildApiUrl(`/api/providers?${query}`));
        const data = await readJsonSafely(response);

        if (!response.ok || !Array.isArray(data)) {
          throw new Error(getApiErrorMessage(response, data, 'Unable to fetch providers right now.'));
        }

        if (isMounted) {
          setProviders(data);
        }
      } catch (err) {
        if (isMounted) {
          setError(err.message || 'Unable to fetch providers right now.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchProviders();

    return () => {
      isMounted = false;
    };
  }, [customerLocation]);

  const visibleProviders = useMemo(() => {
    let filtered = [...providers];

    // Filter by service selection
    if (selectedService) {
      const normalizedService = selectedService.toLowerCase();
      filtered = filtered.filter((provider) => {
        const specialization = String(provider.specialization || provider.service_type || '').toLowerCase();
        const listedServices = String(provider.services || provider.sp_services || '').toLowerCase();
        return specialization.includes(normalizedService) || listedServices.includes(normalizedService);
      });
      if (filtered.length === 0) {
        filtered = [...providers];
      }
    }

    // Filter by search query (name + service)
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((provider) => {
        const name = String(provider.sp_name || provider.full_name || '').toLowerCase();
        const specialization = String(provider.specialization || provider.service_type || '').toLowerCase();
        const services = String(provider.services || provider.sp_services || '').toLowerCase();
        return name.includes(query) || specialization.includes(query) || services.includes(query);
      });
    }

    // Filter by minimum rating
    filtered = filtered.filter((provider) => {
      const rating = Number(provider.average_rating || 0);
      return rating >= minRating;
    });

    // Sort
    const sortedProviders = [...filtered];
    if (sortBy === 'rating') {
      sortedProviders.sort((a, b) => {
        const ratingA = Number(a.average_rating || 0);
        const ratingB = Number(b.average_rating || 0);
        return ratingB - ratingA; // Highest first
      });
    } else if (sortBy === 'price') {
      sortedProviders.sort((a, b) => {
        const priceA = Number(a.hourly_charge || a.hourly_rate || 0);
        const priceB = Number(b.hourly_charge || b.hourly_rate || 0);
        return priceA - priceB; // Lowest first
      });
    } else if (sortBy === 'experience') {
      sortedProviders.sort((a, b) => {
        const expA = Number(a.experience_years || a.experience || 0);
        const expB = Number(b.experience_years || b.experience || 0);
        return expB - expA; // Most experience first
      });
    } else {
      // Default: sort by name
      sortedProviders.sort((a, b) => {
        const nameA = String(a.sp_name || a.full_name || '').toLowerCase();
        const nameB = String(b.sp_name || b.full_name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
    }

    return sortedProviders;
  }, [providers, selectedService, searchQuery, sortBy, minRating]);

  return (
    <section className="section-wrap provider-selection-wrap">
      <div className="sec-label">Select Service Provider</div>
      <p className="selected-service-copy">
        Service Selected: <strong>{selectedService || 'General Home Service'}</strong>
      </p>
      {customerLocation && (
        <div className="location-badge">
          Your area: <strong>{customerLocation}</strong>
        </div>
      )}

      {!loading && !error && (
        <div className="provider-discovery-controls">
          <div className="discovery-search">
            <input
              type="text"
              className="input-field"
              placeholder="Search by name or specialty..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ width: '100%', padding: '10px', borderRadius: '8px', marginBottom: '12px' }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <label className="field-label" style={{ display: 'block', marginBottom: '6px' }}>Sort by</label>
              <select
                className="input-field"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                style={{ width: '100%', padding: '10px', borderRadius: '8px' }}
              >
                <option value="name">Name (A-Z)</option>
                <option value="rating">Highest Rating</option>
                <option value="price">Lowest Price</option>
                <option value="experience">Most Experience</option>
              </select>
            </div>

            <div>
              <label className="field-label" style={{ display: 'block', marginBottom: '6px' }}>Min. Rating</label>
              <select
                className="input-field"
                value={minRating}
                onChange={(e) => setMinRating(Number(e.target.value))}
                style={{ width: '100%', padding: '10px', borderRadius: '8px' }}
              >
                <option value={0}>All ratings</option>
                <option value={3}>3+ stars</option>
                <option value={4}>4+ stars</option>
                <option value={4.5}>4.5+ stars</option>
              </select>
            </div>
          </div>

          {visibleProviders.length > 0 && (
            <p style={{ fontSize: '13px', color: 'var(--ink-500)', marginBottom: '12px' }}>
              Showing {visibleProviders.length} of {providers.length} provider{providers.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {loading && (
        <div className="state-card">
          <p className="state-title">Finding the best providers...</p>
          <p className="state-copy">Loading available professionals for your selected service.</p>
        </div>
      )}

      {error && (
        <div className="state-card error">
          <p className="state-title">Unable to load providers</p>
          <p className="state-copy">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="provider-selection-grid">
          {visibleProviders.map((provider) => {
            const providerName = provider.sp_name || provider.full_name || 'Professional';
            const providerService = provider.specialization || provider.services || provider.sp_services || provider.service_type || 'General Home Service';
            const providerId = provider.sp_id || provider.id;
            const providerPhoto = provider.profile_picture_url || provider.provider_photo || provider.profile_photo || '';
            const providerInitial = (providerName || 'P').trim().charAt(0).toUpperCase();
            const providerAvailability = provider.availability || 'Availability not provided';

            return (
              <article className="card provider-selection-card" key={providerId}>
                <div className="provider-selection-head">
                  <div className="provider-selection-identity">
                    {providerPhoto ? (
                      <img src={providerPhoto} alt={providerName} className="provider-selection-avatar" />
                    ) : (
                      <div className="provider-selection-avatar provider-selection-avatar-fallback">{providerInitial}</div>
                    )}
                    <div>
                      <p className="provider-selection-name">{providerName}</p>
                      <p className="provider-selection-service">{providerService}</p>
                    </div>
                  </div>
                  <p className="provider-selection-rate">{formatHourlyRate(provider)}</p>
                </div>

                <p className="provider-selection-meta"><strong>Experience:</strong> {getExperience(provider)}</p>
                <p className="provider-selection-meta">
                  <strong>Rating:</strong> {Number(provider.average_rating || 0).toFixed(1)} / 5 ⭐
                </p>
                <p className="provider-selection-meta">
                  <strong>Acceptance Rate:</strong> {Number(provider.acceptance_rate || 0).toFixed(0)}%
                </p>
                <p className="provider-selection-meta"><strong>Availability:</strong> {providerAvailability}</p>

                <button
                  type="button"
                  className="btn-p book-now-btn"
                  onClick={() => onBookNow({ ...provider, selected_service_name: selectedService || providerService })}
                >
                  Book Now
                </button>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default ServiceProviderSelectionPage;
