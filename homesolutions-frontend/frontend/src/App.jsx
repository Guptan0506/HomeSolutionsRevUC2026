import React, { useState, useEffect, useRef } from "react";
import { FaFacebook, FaInstagram, FaXTwitter, FaLinkedin } from "react-icons/fa6";
import "./components/App.css"; // Correct path to your styles
import heroImage from "./Assets/1.png";
import logoImage from "./Assets/2.png";
import RequestForm from "./components/RequestForm";
import LoginPage from "./components/LoginPage";
import SignupPage from "./components/SignupPage";
import CustomerProfilePage from "./components/CustomerProfilePage";
import ServiceProviderSelectionPage from "./components/ServiceProviderSelectionPage";
import ServiceProviderProfilePage from "./components/ServiceProviderProfilePage";
import ServiceInvoicePage from "./components/ServiceInvoicePage";
import TroubleshootChatbot from "./components/TroubleshootChatbot";
import Toast from "./components/Toast";
import AdminDashboardPage from "./components/AdminDashboardPage";
import { buildApiUrl, getApiErrorMessage, readJsonSafely, setAuthToken, clearAuthToken } from "./api";

const featuredProfessionals = [
  {
    name: 'Sarah Johnson',
    profession: 'Plumbing Specialist',
    location: 'Downtown',
    experience: '7 years',
    review: 'Arrived on time and fixed a complex leak in one visit. Very professional!'
  },
  {
    name: 'James Wilson',
    profession: 'Licensed Electrician',
    location: 'Westside',
    experience: '9 years',
    review: 'Explained everything clearly and completed the rewiring neatly and quickly.'
  },
  {
    name: 'Jessica Martinez',
    profession: 'Home Cleaning Expert',
    location: 'North Park',
    experience: '5 years',
    review: 'The place looked spotless. Friendly service and excellent attention to detail.'
  },
  {
    name: 'David Thompson',
    profession: 'Appliance Technician',
    location: 'Riverside',
    experience: '8 years',
    review: 'Diagnosed my washer issue fast and had it running perfectly the same day.'
  },
  {
    name: 'Emily Anderson',
    profession: 'Carpentry Professional',
    location: 'East Ridge',
    experience: '6 years',
    review: 'Custom shelf work was flawless and finished exactly when promised.'
  }
];

const serviceCatalog = [
  { name: 'Electric', description: 'Wiring fixes, installations, and safety checks.' },
  { name: 'Plumbing', description: 'Leak repair, drain cleaning, and fixture replacement.' },
  { name: 'Painting', description: 'Interior and exterior painting with smooth finishes.' },
  { name: 'Landscaping', description: 'Lawn care, trimming, and garden upkeep services.' }
];

function getStoredUser() {
  const stored = localStorage.getItem('hs_user');

  if (!stored) {
    return null;
  }

  try {
    return JSON.parse(stored);
  } catch {
    localStorage.removeItem('hs_user');
    return null;
  }
}

function mapCustomerRequest(row) {
  return {
    requestId: row.request_id,
    dateRequested: row.date_required || row.submitted_at,
    providerName: row.provider_name || 'Assigned Provider Pending',
    status: row.status,
    estimate: Number(row.base_rate_per_hour || 0),
    amount: Number(row.total_amount || 0),
    paymentMethod: row.payment_method || '',
    paymentMethodSaved: Boolean(row.payment_method_saved),
    rating: Number(row.customer_rating || 0),
  };
}

function mapProviderRequest(row) {
  return {
    requestId: row.request_id,
    customerName: row.customer_name || 'Customer',
    customerPhoto: row.customer_photo || '',
    contact: row.customer_phone || row.customer_email || 'N/A',
    requestTitle: row.service_name,
    requestDescription: row.description || '',
    requestedAt: row.submitted_at,
    location: row.work_address || 'N/A',
    status: row.status,
    estimatedTime: row.estimated_time || '',
    possibleMaterialsNeeded: row.materials_needed || '',
    eta: row.eta || '',
    materialsUsed: row.materials_used || '',
    hoursWorked: Number(row.hours_worked || 0),
    extraMaterialsCost: Number(row.extra_materials_cost || 0),
    extraFee: Number(row.extra_fee || 0),
    baseRatePerHour: Number(row.base_rate_per_hour || 0),
    subtotal: Number(row.subtotal || 0),
    tax: Number(row.tax || 0),
    commission: Number(row.commission || 0),
    total: Number(row.total_amount || 0),
    completionAt: row.completed_at || '',
    amountReceived: Number(row.total_amount || 0),
  };
}

function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedService, setSelectedService] = useState('');
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [isMarqueePaused, setIsMarqueePaused] = useState(false);
  const [postAuthScreen, setPostAuthScreen] = useState('home');
  const [latestRequest, setLatestRequest] = useState(null);
  const [requestHistory, setRequestHistory] = useState([]);
  const [serviceProviderRequests, setServiceProviderRequests] = useState([]);
  const [invoiceRequest, setInvoiceRequest] = useState(null);
  const [toast, setToast] = useState(null);
  const marqueeViewportRef = useRef(null);
  const servicesSectionRef = useRef(null);
  const [shouldScrollToServices, setShouldScrollToServices] = useState(false);

  const fetchCustomerRequests = async (userId) => {
    try {
      const response = await fetch(buildApiUrl(`/api/requests/user/${userId}`));
      const data = await readJsonSafely(response);

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to load customer requests.'));
      }

      setRequestHistory(data.map(mapCustomerRequest));
    } catch (err) {
      console.error(err.message || err);
      setRequestHistory([]);
    }
  };

  const fetchProviderRequests = async (spId) => {
    if (!spId) {
      setServiceProviderRequests([]);
      return;
    }

    try {
      const response = await fetch(buildApiUrl(`/api/requests/provider/${spId}`));
      const data = await readJsonSafely(response);

      if (!response.ok || !Array.isArray(data)) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to load provider requests.'));
      }

      setServiceProviderRequests(data.map(mapProviderRequest));
    } catch (err) {
      console.error(err.message || err);
      setServiceProviderRequests([]);
    }
  };

  useEffect(() => {
    const loadRequests = async () => {
      if (!currentUser?.user_id) {
        setRequestHistory([]);
        setServiceProviderRequests([]);
        return;
      }

      if (currentUser.user_role === 'customer') {
        await fetchCustomerRequests(currentUser.user_id);
        setServiceProviderRequests([]);
        return;
      }

      let spId = currentUser.sp_id;

      if (!spId) {
        try {
          const response = await fetch(buildApiUrl(`/api/providers/by-user/${currentUser.user_id}`));
          const provider = await readJsonSafely(response);

          if (response.ok && provider?.sp_id) {
            spId = provider.sp_id;
            setCurrentUser((prev) => ({
              ...prev,
              sp_id: provider.sp_id,
              location: provider.sp_location || prev.location || '',
              specialization: provider.specialization || prev.specialization || '',
              availability: provider.availability || prev.availability || '',
              services: provider.services || provider.sp_services || prev.services || '',
              experience_years: provider.experience_years || prev.experience_years || 0,
              base_rate: provider.hourly_charge || prev.base_rate || 0,
            }));
          }
        } catch (err) {
          console.error(err.message || err);
        }
      }

      await fetchProviderRequests(spId);
    };

    loadRequests();
  }, [currentUser?.user_id, currentUser?.user_role, currentUser?.sp_id]);

  useEffect(() => {
    const viewport = marqueeViewportRef.current;

    if (!viewport || currentScreen !== 'home' || isMarqueePaused) {
      return;
    }

    const stepPx = 1;
    const intervalMs = 24;

    const intervalId = window.setInterval(() => {
      const halfWidth = viewport.scrollWidth / 2;

      if (viewport.scrollLeft >= halfWidth) {
        viewport.scrollLeft = 0;
      } else {
        viewport.scrollLeft += stepPx;
      }
    }, intervalMs);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [currentScreen, isMarqueePaused]);

  useEffect(() => {
    if (currentScreen !== 'home' || !shouldScrollToServices) {
      return;
    }

    const scrollId = window.setTimeout(() => {
      servicesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setShouldScrollToServices(false);
    }, 0);

    return () => {
      window.clearTimeout(scrollId);
    };
  }, [currentScreen, shouldScrollToServices]);

  const goToRequestForm = () => {
    setCurrentScreen('home');
    setShouldScrollToServices(true);
  };

  const goToProviderSelection = (serviceName) => {
    setSelectedService(serviceName || 'General Home Service');

    if (!currentUser) {
      openAuth('login', 'providers');
      return;
    }

    setCurrentScreen('providers');
  };

  const handleBookNow = (provider) => {
    setSelectedProvider(provider);
    setCurrentScreen('form');
  };

  const handleChatbotSubmitRequest = (serviceType) => {
    setSelectedService(serviceType || 'General Home Service');
    
    if (!currentUser) {
      openAuth('login', 'form');
    } else {
      setCurrentScreen('form');
    }
  };

  const openAuth = (mode, nextScreen = 'home') => {
    setAuthMode(mode);
    setPostAuthScreen(nextScreen);
    setCurrentScreen('auth');
  };

  const handleEarnClick = () => {
    if (currentUser) {
      setCurrentScreen('profile');
      return;
    }

    openAuth('login', 'profile');
  };

  const handleAuthSuccess = (user, token, expiresAt) => {
    // Store JWT token if provided
    if (token && expiresAt) {
      setAuthToken(token, expiresAt);
    }
    
    setCurrentUser(user);
    localStorage.setItem('hs_user', JSON.stringify(user));
    const nextScreen = user?.user_role === 'service_provider'
      ? 'profile'
      : user?.user_role === 'admin'
        ? 'admin'
        : postAuthScreen;
    setCurrentScreen(nextScreen);
    setPostAuthScreen('home');
  };

  const handleLogout = () => {
    localStorage.removeItem('hs_user');
    clearAuthToken(); // Clear JWT token
    setCurrentUser(null);
    setAuthMode('login');
    setCurrentScreen('home');
    setRequestHistory([]);
    setServiceProviderRequests([]);
    setInvoiceRequest(null);
  };

  const showNotification = (message, type = 'info') => {
    setToast({ message, type });
  };

  const handleProfileSave = async (updatedUser) => {
    if (!currentUser?.user_id) {
      return;
    }

    try {
      const response = await fetch(buildApiUrl(`/api/users/${currentUser.user_id}/profile`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...updatedUser,
          user_role: currentUser.user_role,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to save profile updates.'));
      }

      const nextUser = {
        ...currentUser,
        ...updatedUser,
        ...(data?.user || {}),
      };

      setCurrentUser(nextUser);
      localStorage.setItem('hs_user', JSON.stringify(nextUser));
    } catch (err) {
      console.error(err.message || err);
    }
  };

  const handleRequestUpdate = async (requestId, updates) => {
    setRequestHistory((prev) =>
      prev.map((request) =>
        request.requestId === requestId ? { ...request, ...updates } : request
      )
    );

    try {
      const response = await fetch(buildApiUrl(`/api/requests/${requestId}/customer`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payment_method: updates.paymentMethod,
          payment_method_saved: updates.paymentMethodSaved,
          customer_rating: updates.rating,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to update request details.'));
      }

      if (currentUser?.user_id) {
        await fetchCustomerRequests(currentUser.user_id);
      }
    } catch (err) {
      console.error(err.message || err);
    }
  };

  const handleServiceProviderRequestUpdate = async (requestId, updates) => {
    setServiceProviderRequests((prev) =>
      prev.map((request) => {
        if (request.requestId !== requestId) {
          return request;
        }

        const nextRequest = { ...request, ...updates };
        const status = nextRequest.status;

        if (status === 'completed' && (!nextRequest.amountReceived || Number(nextRequest.amountReceived) <= 0)) {
          nextRequest.amountReceived = Number(nextRequest.amountReceived || request.amountReceived || 0);
        }

        if (status === 'rejected') {
          nextRequest.amountReceived = 0;
        }

        return nextRequest;
      })
    );

    try {
      let action = '';
      let notificationMessage = '';

      if (updates.status === 'in_progress') {
        action = 'accept';
        notificationMessage = 'Request accepted successfully! 🎉';
      } else if (updates.status === 'rejected') {
        action = 'decline';
        notificationMessage = 'Request declined.';
      } else if (updates.status === 'completed') {
        action = 'complete';
        notificationMessage = 'Service completed! Invoice generated. 📄';
      }

      if (!action) {
        return;
      }

      const response = await fetch(buildApiUrl(`/api/requests/${requestId}/provider`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          estimated_time: updates.estimatedTime,
          materials_needed: updates.possibleMaterialsNeeded,
          eta: updates.eta,
          materials_used: updates.materialsUsed,
          hours_worked: updates.hoursWorked,
          extra_materials_cost: updates.extraMaterialsCost,
          extra_fee: updates.extraFee,
          base_rate_per_hour: updates.baseRatePerHour,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to update service request.'));
      }

      // Show success notification
      showNotification(notificationMessage, 'success');

      if (currentUser?.sp_id) {
        await fetchProviderRequests(currentUser.sp_id);
      }
    } catch (err) {
      console.error(err.message || err);
      showNotification('Error updating request. Please try again.', 'error');
    }
  };

  const handleViewInvoice = async (request) => {
    try {
      const response = await fetch(buildApiUrl(`/api/invoices/${request.requestId}`));
      const data = await readJsonSafely(response);

      if (!response.ok) {
        throw new Error(getApiErrorMessage(response, data, 'Unable to fetch invoice details.'));
      }

      setInvoiceRequest({
        invoiceId: data.invoice_id,
        requestId: data.request_id,
        requestedAt: (data.request_date && data.request_time)
          ? `${data.request_date}T${data.request_time}`
          : (data.request_date || request.requestedAt),
        completionAt: (data.completion_date && data.completion_time)
          ? `${data.completion_date}T${data.completion_time}`
          : (data.completion_date || request.completionAt),
        baseRatePerHour: Number(data.base_rate_per_hour || 0),
        hoursWorked: Number(data.hours_worked || 0),
        extraMaterialsCost: Number(data.extra_materials_cost || 0),
        extraFee: Number(data.extra_fee || 0),
      });
      setCurrentScreen('invoice');
    } catch (err) {
      console.error(err.message || err);
    }
  };

  const renderSharedFooter = () => (
    <footer className="home-footer" aria-label="FixMate footer">
      <p>Phone: +1 (555) 987-1234</p>
        <p>Email: support@fixmate.com</p>
      <div className="social-row" aria-label="Social media">
        <a href="https://facebook.com" className="social-pill" title="Facebook" target="_blank" rel="noopener noreferrer">
          <FaFacebook size={18} />
        </a>
        <a href="https://instagram.com" className="social-pill" title="Instagram" target="_blank" rel="noopener noreferrer">
          <FaInstagram size={18} />
        </a>
        <a href="https://twitter.com" className="social-pill" title="X (Twitter)" target="_blank" rel="noopener noreferrer">
          <FaXTwitter size={18} />
        </a>
        <a href="https://linkedin.com" className="social-pill" title="LinkedIn" target="_blank" rel="noopener noreferrer">
          <FaLinkedin size={18} />
        </a>
      </div>
      <p className="copyright">&copy; FixMate</p>
    </footer>
  );

  const scrollMarqueeBy = (deltaPx) => {
    if (marqueeViewportRef.current) {
      marqueeViewportRef.current.scrollBy({ left: deltaPx, behavior: 'smooth' });
    }
  };

  return (
    <>
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onDismiss={() => setToast(null)}
        />
      )}
      <div className="shell">
        <div className="phone">
          <div className="topbar">
            <div className="topbar-left">
              <button className="brand-wrap" onClick={() => setCurrentScreen('home')}>
                <img src={logoImage} alt="FixMate" className="brand-logo" />
                <span>
                  <span className="topbar-kicker">HOME MAINTENANCE</span>
                  <span className="topbar-brand">FixMate</span>
                </span>
              </button>
            </div>

            <div className="topbar-nav" role="navigation" aria-label="Main navigation">
              <button className="btn-s nav-btn" onClick={goToRequestForm}>Service</button>
              <button className="btn-p nav-btn" onClick={handleEarnClick}>Earn</button>
            </div>

            <div className="topbar-user-area">
              {!currentUser ? (
                <>
                  <button className="btn-s nav-auth-btn" onClick={() => openAuth('login', 'home')}>Log In</button>
                  <button className="btn-p nav-auth-btn" onClick={() => openAuth('signup', 'home')}>Sign Up</button>
                </>
              ) : (
                <>
                  {currentUser?.user_role === 'admin' && (
                    <button className="btn-s nav-auth-btn admin-btn" onClick={() => setCurrentScreen('admin')}>
                      Admin Dashboard
                    </button>
                  )}
                  <button className="btn-s nav-auth-btn" onClick={() => setCurrentScreen('profile')}>Profile</button>
                  <button className="btn-s btn-logout nav-auth-btn" onClick={handleLogout}>Log Out</button>
                </>
              )}
            </div>
          </div>

          <div className="body">
          {currentScreen === 'home' && (
            <>
              <div className="hero-band">
                <div className="hero-image-panel" aria-hidden="true">
                  <img src={heroImage} alt="" className="hero-img" />
                </div>

                <div className="hero-content">
                  <div className="hero-text-wrap">
                    <p className="hero-eyebrow">Fast booking. Trusted experts.</p>
                    <h1>Your home deserves five-star care.</h1>
                    <p className="hero-sub">
                      Discover local professionals for plumbing, electrical, and maintenance work in just a few taps.
                    </p>
                  </div>

                  <div className="hero-actions">
                    <button className="btn-p" onClick={goToRequestForm}>Request a Service</button>
                  </div>

                  <div className="stats-grid">
                    <div className="stat-card">
                      <span className="stat-value">24/7</span>
                      <span className="stat-label">Emergency Support</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-value">4.9/5</span>
                      <span className="stat-label">Avg. Client Rating</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-value">30m</span>
                      <span className="stat-label">Average Response</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pro-marquee" aria-label="Featured professionals and customer feedback">
                <div className="pro-marquee-head">
                  <p className="pro-marquee-title">Featured Professionals</p>
                  <div className="pro-marquee-controls">
                    <button
                      className="marquee-control-btn"
                      type="button"
                      aria-label="Scroll featured professionals left"
                      onClick={() => scrollMarqueeBy(-320)}
                    >
                      Prev
                    </button>
                    <button
                      className="marquee-control-btn"
                      type="button"
                      aria-label="Scroll featured professionals right"
                      onClick={() => scrollMarqueeBy(320)}
                    >
                      Next
                    </button>
                  </div>
                </div>

                <div
                  className="pro-marquee-viewport"
                  ref={marqueeViewportRef}
                  onMouseEnter={() => setIsMarqueePaused(true)}
                  onMouseLeave={() => setIsMarqueePaused(false)}
                  onFocusCapture={() => setIsMarqueePaused(true)}
                  onBlurCapture={() => setIsMarqueePaused(false)}
                >
                  <div className="pro-marquee-track">
                  {[...featuredProfessionals, ...featuredProfessionals].map((pro, index) => (
                    <article className="pro-marquee-item" key={`${pro.name}-${index}`}>
                      <p className="pro-marquee-name">{pro.name}</p>
                      <p className="pro-marquee-role">{pro.profession}</p>
                      <p className="pro-marquee-meta">{pro.location} | {pro.experience} experience</p>
                      <p className="pro-marquee-review">"{pro.review}"</p>
                    </article>
                  ))}
                  </div>
                </div>
              </div>

              <section className="services-section" aria-label="Services" ref={servicesSectionRef}>
                <div className="sec-label">Services</div>
                <div className="services-grid">
                  {serviceCatalog.map((service) => (
                    <article key={service.name} className="service-item card">
                      <p className="service-name">{service.name}</p>
                      <p className="service-copy">{service.description}</p>
                      <button
                        type="button"
                        className="btn-s service-select-btn"
                        onClick={() => goToProviderSelection(service.name)}
                      >
                        Select Provider
                      </button>
                    </article>
                  ))}
                </div>
              </section>

              {renderSharedFooter()}
            </>
          )}

          {currentScreen === 'providers' && (
            <>
              <ServiceProviderSelectionPage
                selectedService={selectedService}
                customerLocation={currentUser?.location || ''}
                onBookNow={handleBookNow}
              />
              {renderSharedFooter()}
            </>
          )}

          {currentScreen === 'form' && (
            <RequestForm
              currentUser={currentUser}
              selectedProvider={selectedProvider}
              selectedService={selectedService}
              onBack={() => setCurrentScreen('providers')}
              onSuccess={async (requestSummary) => {
                if (currentUser?.user_id) {
                  await fetchCustomerRequests(currentUser.user_id);
                }

                if (selectedProvider?.sp_id || currentUser?.sp_id) {
                  await fetchProviderRequests(selectedProvider?.sp_id || currentUser?.sp_id);
                }

                setLatestRequest(requestSummary);
                setCurrentScreen('confirmation');
              }}
            />
          )}

          {currentScreen === 'confirmation' && latestRequest && (
            <section className="section-wrap confirmation-wrap">
              <div className="sec-label">Order Confirmation</div>
              <div className="card confirmation-card">
                <p className="confirmation-title">Thank you for placing your order!</p>
                <p className="confirmation-copy">
                  Your request has been sent. Here is a summary of the options you selected.
                </p>

                <div className="confirmation-grid">
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Request Title</p>
                    <p className="confirmation-item-value">{latestRequest.requestTitle}</p>
                  </div>
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Provider</p>
                    <p className="confirmation-item-value">{latestRequest.providerName}</p>
                  </div>
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Service Date</p>
                    <p className="confirmation-item-value">{latestRequest.preferredDate || 'Not specified'}</p>
                  </div>
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Urgency</p>
                    <p className="confirmation-item-value">{latestRequest.urgency}</p>
                  </div>
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Address</p>
                    <p className="confirmation-item-value">{latestRequest.address}</p>
                  </div>
                  <div className="confirmation-item">
                    <p className="confirmation-item-label">Uploaded Files</p>
                    <p className="confirmation-item-value">{latestRequest.attachmentCount} file(s)</p>
                  </div>
                </div>

                <div className="confirmation-item confirmation-description">
                  <p className="confirmation-item-label">Issue Description</p>
                  <p className="confirmation-item-value">{latestRequest.description}</p>
                </div>

                <div className="confirmation-item confirmation-description">
                  <p className="confirmation-item-label">Availability Slots</p>
                  {latestRequest.availabilitySlots.length > 0 ? (
                    latestRequest.availabilitySlots.map((slot) => (
                      <p className="confirmation-item-value" key={slot.id}>
                        {slot.date} | {slot.start} - {slot.end}
                      </p>
                    ))
                  ) : (
                    <p className="confirmation-item-value">No custom availability slots added.</p>
                  )}
                </div>

                <div className="form-actions" style={{ marginTop: '14px' }}>
                  <button type="button" className="btn-s" onClick={() => setCurrentScreen('home')}>
                    Back to Home
                  </button>
                  <button type="button" className="btn-p" onClick={() => setCurrentScreen('form')}>
                    Request Another Service
                  </button>
                </div>
              </div>
            </section>
          )}

          {currentScreen === 'auth' && (
            authMode === 'login' ? (
              <LoginPage
                onLoginSuccess={handleAuthSuccess}
                onSwitchToSignup={() => setAuthMode('signup')}
              />
            ) : (
              <SignupPage
                onSignupSuccess={handleAuthSuccess}
                onSwitchToLogin={() => setAuthMode('login')}
              />
            )
          )}

          {currentScreen === 'profile' && currentUser && (
            <>
              {currentUser.user_role === 'service_provider' ? (
                <ServiceProviderProfilePage
                  currentUser={currentUser}
                  serviceRequests={serviceProviderRequests}
                  onProfileSave={handleProfileSave}
                  onRequestUpdate={handleServiceProviderRequestUpdate}
                  onViewInvoice={handleViewInvoice}
                />
              ) : (
                <CustomerProfilePage
                  currentUser={currentUser}
                  requestHistory={requestHistory}
                  onProfileSave={handleProfileSave}
                  onRequestUpdate={handleRequestUpdate}
                />
              )}
              {renderSharedFooter()}
            </>
          )}

            {currentScreen === 'invoice' && (
              <>
                <ServiceInvoicePage
                  invoiceRequest={invoiceRequest}
                  onBackToProfile={() => setCurrentScreen('profile')}
                />
                {renderSharedFooter()}
              </>
            )}

            {currentScreen === 'admin' && currentUser?.user_role === 'admin' && (
              <AdminDashboardPage
                onLogout={handleLogout}
                currentUser={currentUser}
              />
            )}
          </div>
        </div>
      </div>
      <TroubleshootChatbot onNavigateToRequest={handleChatbotSubmitRequest} />
    </>
  );
}

export default App;