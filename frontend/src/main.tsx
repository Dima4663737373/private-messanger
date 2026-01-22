import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary'

console.log('🚀 Starting app initialization...');
console.log('React version:', React?.version || 'unknown');

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

function initApp() {
  try {
    const rootElement = document.getElementById('root');
    if (!rootElement) {
      throw new Error('Root element not found');
    }

    console.log('✅ Root element found, creating root...');
    
    // Verify React is available
    if (typeof React === 'undefined') {
      throw new Error('React is not defined');
    }
    if (typeof createRoot === 'undefined') {
      throw new Error('createRoot is not defined');
    }

    const root = createRoot(rootElement);
    
    console.log('✅ Root created, rendering app...');
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>
    );
    console.log('✅ App rendered successfully');
  } catch (error) {
    console.error('❌ Failed to render app:', error);
    const rootElement = document.getElementById('root');
    if (rootElement) {
      rootElement.innerHTML = `
        <div style="padding: 20px; font-family: sans-serif; max-width: 600px; margin: 50px auto;">
          <h1 style="color: #d32f2f;">Error loading application</h1>
          <p><strong>Error:</strong> ${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p>Please check the console for more details.</p>
          <button onclick="window.location.reload()" style="padding: 10px 20px; margin-top: 10px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">
            Reload Page
          </button>
        </div>
      `;
    }
  }
}
