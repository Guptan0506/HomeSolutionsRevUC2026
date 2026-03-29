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

function getProviderRating(provider) {
  if (provider.rating && Number(provider.rating) > 0) {
    return Number(provider.rating).toFixed(1);
  }

  const experience = Number(provider.experience_years || provider.experience || 0);
  const generated = Math.min(4.9, 4.2 + experience * 0.08);
  return generated.toFixed(1);
}

function ServiceProviderSelectionPage({ selectedService, onBookNow }) {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isMounted = true;

    const fetchProviders = async () => {
      setLoading(true);
      setError('');

      try {
        const response = await fetch(buildApiUrl('/api/providers'));
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
  }, []);

  const visibleProviders = useMemo(() => {
    if (!selectedService) {
      return providers;
    }

    const normalizedService = selectedService.toLowerCase();
    const filtered = providers.filter((provider) => {
      const specialization = String(provider.specialization || provider.service_type || '').toLowerCase();
      const listedServices = String(provider.services || '').toLowerCase();
      return specialization.includes(normalizedService) || listedServices.includes(normalizedService);
    });

    return filtered.length > 0 ? filtered : providers;
  }, [providers, selectedService]);

  return (
    <section className="section-wrap provider-selection-wrap">
      <div className="sec-label">Select Service Provider</div>
      <p className="selected-service-copy">
        Service Selected: <strong>{selectedService || 'General Home Service'}</strong>
      </p>

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
            const providerService = provider.specialization || provider.service_type || 'General Home Service';
            const providerId = provider.sp_id || provider.id;

            return (
              <article className="card provider-selection-card" key={providerId}>
                <div className="provider-selection-head">
                  <div>
                    <p className="provider-selection-name">{providerName}</p>
                    <p className="provider-selection-service">{providerService}</p>
                  </div>
                  <p className="provider-selection-rate">{formatHourlyRate(provider)}</p>
                </div>

                <p className="provider-selection-meta"><strong>Experience:</strong> {getExperience(provider)}</p>
                <p className="provider-selection-meta"><strong>Rating:</strong> {getProviderRating(provider)} / 5</p>

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
