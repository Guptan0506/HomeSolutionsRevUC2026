import React, { useState, useEffect } from "react";
import "./components/App.css"; // Correct path to your styles
import ProvidersList from "./components/ProvidersList";
import RequestForm from "./components/RequestForm";
import './components/App.css'; // Ensure this path is correct

function App() {
  const [currentScreen, setCurrentScreen] = useState('home');
  const [providers, setProviders] = useState([]);

  // This is where we will eventually fetch from PostgreSQL
  const loadProviders = async () => {
    // For now, these are placeholders
    const mockData = [
      { id: 1, name: "Mike Johnson", type: "Plumbing", experience: 12, price: 85, initials: "MJ" },
      { id: 2, name: "Sarah Smith", type: "Electrical", experience: 8, price: 95, initials: "SS" }
    ];
    setProviders(mockData);
    setCurrentScreen('providers');
  };

  return (
    <div className="shell">
      {/* 1. The Navigation Tabs (matches .tab-bar and .tab in CSS) */}
      <div className="tab-bar">
        <div className={`tab ${currentScreen === 'home' ? 'on' : ''}`} onClick={() => setCurrentScreen('home')}>Home</div>
        <div className={`tab ${currentScreen === 'providers' ? 'on' : ''}`} onClick={loadProviders}>Find Pros</div>
      </div>

      <div className="phone">
        {/* 2. Top Bar (matches .topbar in CSS) */}
        <div className="topbar">
          <div className="topbar-brand">HomeSolutions</div>
        </div>

        <div className="body">
          {/* 3. The Screens */}
          {currentScreen === 'home' && (
            <div className="hero-band">
              <h1>Reliable help, right at your doorstep.</h1>
              <button className="btn-p" onClick={loadProviders}>Book a Service</button>
            </div>
          )}

          {currentScreen === 'providers' && (
            <div className="section-wrap">
              <div className="sec-label">Available Professionals</div>
              <ProvidersList onSelect={() => setCurrentScreen('form')} />
            </div>
          )}

          {currentScreen === 'form' && (
            <RequestForm onSuccess={() => setCurrentScreen('home')} />
          )}
        </div>
      </div>
    </div>
  );
}  

export default App;