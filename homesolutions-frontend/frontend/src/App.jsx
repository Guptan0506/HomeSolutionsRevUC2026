import React, { useState, useEffect } from "react";
import "./components/App.css"; // Correct path to your styles
import ProvidersList from "./components/ProvidersList";
import RequestForm from "./components/RequestForm";

function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [selectedProvider, setSelectedProvider] = useState(null);

  useEffect(() => {
    if (currentScreen !== 'form') {
      setSelectedProvider(null);
    }
  }, [currentScreen]);

  const goToProviders = () => {
    setCurrentScreen('providers');
  };

  const handleSelectProvider = (provider) => {
    setSelectedProvider(provider);
    setCurrentScreen('form');
  };

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
          <div className="signal-dot" aria-hidden="true" />
        </div>

        <div className="body">
          {currentScreen === 'home' && (
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
          )}

          {currentScreen === 'providers' && (
            <div className="section-wrap">
              <div className="sec-label">Available Professionals</div>
              <ProvidersList onSelect={handleSelectProvider} />
            </div>
          )}

          {currentScreen === 'form' && (
            <RequestForm
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