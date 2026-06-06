// public/js/auth.js
import { firebaseAuth }              from './firebase-config.js';
import { toast }                     from './api.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  updateProfile,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const googleProvider = new GoogleAuthProvider();

// ── Redirect if already signed in ────────────────────────────────────────
onAuthStateChanged(firebaseAuth, user => {
  if (user && (
    window.location.pathname === '/index.html' ||
    window.location.pathname === '/register.html' ||
    window.location.pathname === '/'
  )) {
    window.location.href = '/dashboard.html';
  }
});

// ── Shared Google sign-in handler ─────────────────────────────────────────
async function signInWithGoogle(btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Connecting…';
  try {
    await signInWithPopup(firebaseAuth, googleProvider);
    window.location.href = '/dashboard.html';
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 48 48" style="flex-shrink:0"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-3.59-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg> Continue with Google`;
    const messages = {
      'auth/popup-closed-by-user':    'Sign-in popup was closed.',
      'auth/cancelled-popup-request': 'Sign-in was cancelled.',
      'auth/popup-blocked':           'Popup blocked. Please allow popups for this site.',
    };
    toast(messages[err.code] || err.message, 'error');
  }
}

// Wire Google buttons on whichever page loaded this script
document.querySelectorAll('.btn-google').forEach(btn => {
  btn.addEventListener('click', () => signInWithGoogle(btn));
});

// ── Login form ────────────────────────────────────────────────────────────
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn      = loginForm.querySelector('button[type="submit"]');
    const email    = loginForm.email.value.trim();
    const password = loginForm.password.value;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      await signInWithEmailAndPassword(firebaseAuth, email, password);
      window.location.href = '/dashboard.html';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sign In';
      const messages = {
        'auth/user-not-found':     'No account found with that email.',
        'auth/wrong-password':     'Incorrect password. Please try again.',
        'auth/invalid-email':      'Please enter a valid email address.',
        'auth/too-many-requests':  'Too many failed attempts. Try again later.',
        'auth/invalid-credential': 'Incorrect email or password.',
      };
      toast(messages[err.code] || err.message, 'error');
    }
  });
}

// ── Register form ─────────────────────────────────────────────────────────
const registerForm = document.getElementById('register-form');
if (registerForm) {
  registerForm.addEventListener('submit', async e => {
    e.preventDefault();
    const btn      = registerForm.querySelector('button[type="submit"]');
    const name     = registerForm.username.value.trim();
    const email    = registerForm.email.value.trim();
    const password = registerForm.password.value;

    if (name.length < 2)   { toast('Name must be at least 2 characters.', 'error'); return; }
    if (password.length < 6) { toast('Password must be at least 6 characters.', 'error'); return; }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span>';

    try {
      const { user } = await createUserWithEmailAndPassword(firebaseAuth, email, password);
      await updateProfile(user, { displayName: name });
      window.location.href = '/dashboard.html';
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Create Account';
      const messages = {
        'auth/email-already-in-use': 'An account with that email already exists.',
        'auth/invalid-email':        'Please enter a valid email address.',
        'auth/weak-password':        'Password too weak. Use at least 6 characters.',
      };
      toast(messages[err.code] || err.message, 'error');
    }
  });
}
