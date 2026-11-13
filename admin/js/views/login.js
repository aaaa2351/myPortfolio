import { h } from '../dom.js';
import { icon } from '../icons.js';

const MESSAGES = {
  not_authorised: 'That Google account is not authorised for this site. Sign in with the account that owns it.',
  login_expired: 'The sign-in attempt expired. Start again.',
  login_failed: 'Sign-in could not be completed. Try again.',
  login_cancelled: 'Sign-in was cancelled.',
  admin_disabled: 'The admin area is turned off on this deployment. Use the production site to sign in.',
  not_configured: 'The CMS is not fully configured on the server yet. See docs/SETUP.md.',
  session_expired: 'Your session expired. Sign in again.',
  invalid_session: 'Your session was not valid. Sign in again.'
};

export function loginMessage(code) {
  return code ? MESSAGES[code] || null : null;
}

export function loginView({ reason, authError }) {
  const message = loginMessage(authError) || loginMessage(reason);
  const blocked = reason === 'admin_disabled' || reason === 'not_configured';
  return h(
    'div',
    { class: 'boot' },
    h(
      'div',
      { class: 'boot-card login-card' },
      h('span', { class: 'brand-mark', 'aria-hidden': 'true' }),
      h('h1', {}, 'Portfolio CMS'),
      h('p', { class: 'muted' }, 'Private dashboard. Sign in with the Google account authorised for this site.'),
      message && h('p', { class: 'login-message', role: 'alert' }, icon('alert', 16), h('span', {}, message)),
      blocked ? null : h('a', { class: 'btn btn-primary login-button', href: '/api/auth/login' }, icon('shield', 18), h('span', {}, 'Continue with Google')),
      h('a', { class: 'link login-back', href: '/' }, 'Back to the portfolio')
    )
  );
}
