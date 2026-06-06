// public/js/api.js
// Shared utilities used by every page:
//   - toast()      → show copper-glass toast notification
//   - apiFetch()   → authenticated fetch to Express REST API
//   - initNav()    → populate the sticky nav and logout button
//   - guardAuth()  → redirect to /index.html if not signed in

import { firebaseAuth } from './firebase-config.js';
import {
  onAuthStateChanged,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

// ── Toast notifications ──────────────────────────────────────────────────

const ICONS = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

/**
 * Show a self-dismissing toast notification.
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} type
 * @param {number} duration  ms before auto-dismiss (default 4000)
 */
export function toast(message, type = 'info', duration = 4000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span style="font-weight:700;flex-shrink:0">${ICONS[type] || 'ℹ'}</span><span>${message}</span>`;
  container.appendChild(el);

  const dismiss = () => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };

  setTimeout(dismiss, duration);
  el.addEventListener('click', dismiss);
}

// ── Authenticated fetch ──────────────────────────────────────────────────

/**
 * Wraps fetch() — automatically attaches the current user's Firebase ID token.
 * Throws an Error with the server's { error } message on non-2xx responses.
 *
 * @param {string} url        API path, e.g. '/api/auth/profile'
 * @param {RequestInit} opts  Standard fetch options
 * @returns {Promise<any>}    Parsed JSON body
 */
export async function apiFetch(url, opts = {}) {
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Not authenticated.');

  const idToken = await user.getIdToken();
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${idToken}`,
    ...(opts.headers || {}),
  };

  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

// ── Nav ──────────────────────────────────────────────────────────────────

/**
 * Populates the #nav bar with the current user's name and wires the
 * logout button.  Call this on every authenticated page.
 */
export function initNav(activePath) {
  onAuthStateChanged(firebaseAuth, user => {
    const nav = document.getElementById('nav');
    if (!nav) return;

    if (user) {
      const nameEl = document.getElementById('nav-username');
      if (nameEl) nameEl.textContent = user.displayName || user.email;

      // Mark active link
      if (activePath) {
        nav.querySelectorAll('.nav-links a').forEach(a => {
          if (a.getAttribute('href') === activePath) a.classList.add('active');
        });
      }
    }
  });

  // Logout button
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await signOut(firebaseAuth);
      window.location.href = '/index.html';
    });
  }
}

// ── Auth guard ───────────────────────────────────────────────────────────

/**
 * Call at the top of every protected page.
 * Returns a Promise that resolves with the Firebase user if signed in,
 * or redirects to /index.html if not.
 */
export function guardAuth() {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(firebaseAuth, user => {
      unsub();
      if (!user) {
        window.location.href = '/index.html';
      } else {
        resolve(user);
      }
    });
  });
}
