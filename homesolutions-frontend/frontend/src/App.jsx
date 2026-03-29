import React, { useState, useEffect, useRef } from "react";
import "./components/App.css"; // Correct path to your styles
import ProvidersList from "./components/ProvidersList";
import RequestForm from "./components/RequestForm";
import LoginPage from "./components/LoginPage";
import SignupPage from "./components/SignupPage";

const featuredProfessionals = [
  {
    name: 'Riya Mehta',
    profession: 'Plumbing Specialist',
    location: 'Downtown',
    experience: '7 years',
    review: 'Arrived on time and fixed a complex leak in one visit. Very professional!'
  },
  {
    name: 'Arjun Nair',
    profession: 'Licensed Electrician',
    location: 'Westside',
    experience: '9 years',
    review: 'Explained everything clearly and completed the rewiring neatly and quickly.'
  },
  {
    name: 'Sana Khan',
    profession: 'Home Cleaning Expert',
    location: 'North Park',
    experience: '5 years',
    review: 'The place looked spotless. Friendly service and excellent attention to detail.'
  },
  {
    name: 'Dev Patel',
    profession: 'Appliance Technician',
    location: 'Riverside',
    experience: '8 years',
    review: 'Diagnosed my washer issue fast and had it running perfectly the same day.'
  },
  {
    name: 'Neha Iyer',
    profession: 'Carpentry Professional',
    location: 'East Ridge',
    experience: '6 years',
    review: 'Custom shelf work was flawless and finished exactly when promised.'
  }
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

function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedProvider, setSelectedProvider] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [isMarqueePaused, setIsMarqueePaused] = useState(false);
  const marqueeViewportRef = useRef(null);

  useEffect(() => {
    if (currentScreen !== 'form') {
      setSelectedProvider(null);
    }
  }, [currentScreen]);

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

  const goToProviders = () => {
    setCurrentScreen('providers');
  };

  const handleSelectProvider = (provider) => {
    setSelectedProvider(provider);
    setCurrentScreen('form');
  };

  const handleAuthSuccess = (user) => {
    setCurrentUser(user);
    localStorage.setItem('hs_user', JSON.stringify(user));
    setCurrentScreen('home');
  };

  const handleLogout = () => {
    localStorage.removeItem('hs_user');
    setCurrentUser(null);
    setAuthMode('login');
    setCurrentScreen('home');
    setSelectedProvider(null);
  };

  const scrollMarqueeBy = (deltaPx) => {
    if (marqueeViewportRef.current) {
      marqueeViewportRef.current.scrollBy({ left: deltaPx, behavior: 'smooth' });
    }
  };

  if (!currentUser) {
    return (
      <div className="shell">
        <div className="phone auth-shell">
          <div className="topbar">
            <div>
              <div className="topbar-kicker">WELCOME</div>
              <div className="topbar-brand">HomeSolutions</div>
            </div>
            <div className="signal-dot" aria-hidden="true" />
          </div>

          <div className="body">
            {authMode === 'login' ? (
              <LoginPage
                onLoginSuccess={handleAuthSuccess}
                onSwitchToSignup={() => setAuthMode('signup')}
              />
            ) : (
              <SignupPage
                onSignupSuccess={handleAuthSuccess}
                onSwitchToLogin={() => setAuthMode('login')}
              />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="tab-bar">
        <button className={`tab ${currentScreen === 'home' ? 'on' : ''}`} onClick={() => setCurrentScreen('home')}>Home</button>
        <button className={`tab ${currentScreen === 'providers' ? 'on' : ''}`} onClick={goToProviders}>Find Pros</button>
        <button className={`tab ${currentScreen === 'form' ? 'on' : ''}`} onClick={() => setCurrentScreen('form')}>Request</button>
      </div>

      <div className="phone">
        <div className="topbar">
          <div>
            <div className="topbar-kicker">HOME MAINTENANCE</div>
            <div className="topbar-brand">HomeSolutions</div>
          </div>

          <div className="topbar-user-area">
            <div className="user-chip">Hi, {currentUser.full_name || 'User'}</div>
            <button className="btn-s btn-logout" onClick={handleLogout}>Log Out</button>
          </div>
        </div>

        <div className="body">
          {currentScreen === 'home' && (
            <>
              <div className="hero-band">
                <div className="hero-text-wrap">
                  <p className="hero-eyebrow">Fast booking. Trusted experts.</p>
                  <h1>Your home deserves five-star care.</h1>
                  <p className="hero-sub">
                    Discover local professionals for plumbing, electrical, and maintenance work in just a few taps.
                  </p>
                </div>

                <div className="hero-actions">
                  <button className="btn-p" onClick={goToProviders}>Find a Professional</button>
                  <button className="btn-s" onClick={() => setCurrentScreen('form')}>Request Directly</button>
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
            </>
          )}

          {currentScreen === 'providers' && (
            <div className="section-wrap">
              <div className="sec-label">Available Professionals</div>
              <ProvidersList onSelect={handleSelectProvider} />
            </div>
          )}

          {currentScreen === 'form' && (
            <RequestForm
              currentUser={currentUser}
              selectedProvider={selectedProvider}
              onBack={goToProviders}
              onSuccess={() => setCurrentScreen('home')}
            />
          )}
        </div>
      </div>
    </div>
  );
}  

export default App;