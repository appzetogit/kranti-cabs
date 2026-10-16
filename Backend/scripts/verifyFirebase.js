/**
 * Confirms the Firebase admin SDK is actually usable, not merely configured.
 *
 * Sending to a deliberately invalid token is the check: FCM only reaches the
 * "invalid registration token" error *after* it has authenticated the service
 * account. A credential problem fails earlier and differently, so the two are
 * distinguishable.
 */
import { getFirebaseMessaging } from '../src/config/firebase.js';

const run = async () => {
  const messaging = getFirebaseMessaging();

  if (!messaging) {
    console.log(JSON.stringify({ messagingInitialised: false, reason: 'getFirebaseMessaging() returned null' }, null, 1));
    process.exit(1);
  }

  let credentialsAccepted = false;
  let detail = '';

  try {
    await messaging.send({
      token: 'definitely-not-a-real-fcm-token',
      notification: { title: 'probe', body: 'probe' },
    });
    credentialsAccepted = true; // would be surprising
    detail = 'send unexpectedly succeeded';
  } catch (error) {
    const code = error?.errorInfo?.code || error?.code || '';
    detail = code || error.message;
    // reached token validation => the service account authenticated fine
    credentialsAccepted =
      code.includes('invalid-argument') ||
      code.includes('registration-token-not-registered') ||
      code.includes('invalid-registration-token');
  }

  console.log(JSON.stringify({ messagingInitialised: true, credentialsAccepted, detail }, null, 1));
  process.exit(credentialsAccepted ? 0 : 1);
};

run().catch((e) => {
  console.error('probe failed:', e.message);
  process.exit(1);
});
