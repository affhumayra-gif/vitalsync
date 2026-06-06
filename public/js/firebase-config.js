// public/js/firebase-config.js
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

console.log('Loading firebase-config.js...');

// Fetch config from backend
const response = await fetch('/api/firebase-config');
const firebaseConfig = await response.json();

console.log('Firebase config received:', firebaseConfig);

if (!firebaseConfig.apiKey) {
  console.error('No API key in config! Check your .env file');
}

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

console.log('Firebase initialized');