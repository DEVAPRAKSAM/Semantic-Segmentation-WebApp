// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';  // Optional, for global styles
import App from './App';  // The root App component
import reportWebVitals from './reportWebVitals';  // Optional, for performance tracking

// Create a root element and render the app inside the root div in the public/index.html
const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Optional: If you want to measure performance, you can pass a function to log results
reportWebVitals();
