const { auth } = require('../firebase/admin');

/**
 * Verifies the Firebase ID token in the Authorization header.
 * Attaches decoded token as req.user = { uid, email, name }.
 * Returns 401 if missing or invalid.
 */
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header.' });
  }

  const idToken = header.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(idToken);
    req.user = {
      uid:   decoded.uid,
      email: decoded.email,
      name:  decoded.name || decoded.email,
    };
    next();
  } catch (err) {
    console.error('[auth middleware]', err.message);
    return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
  }
}

module.exports = { requireAuth };
