import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authenticate } from '../../middleware/authenticate.js';
import { verifyCsrf } from '../../middleware/csrf.js';
import { limiters } from '../../middleware/rate-limit.js';
import { documentRoute } from '../../docs/registry.js';
import * as c from './auth.controller.js';
import * as s from './auth.schema.js';

const router = Router();
const tag = 'Auth';

router.post('/login', limiters.auth, validate({ body: s.loginBody }), c.login);
router.post('/refresh', limiters.refresh, verifyCsrf, c.refresh);
router.post('/logout', verifyCsrf, c.logout);
router.post('/switch-context', limiters.auth, verifyCsrf, validate({ body: s.switchContextBody }), c.switchContext);
router.post('/forgot-password', limiters.auth, validate({ body: s.forgotBody }), c.forgotPassword);
router.get('/token-info', limiters.auth, validate({ query: s.tokenQuery }), c.tokenInfo);
router.post('/accept-invite', limiters.auth, validate({ body: s.setPasswordBody }), c.acceptInvite);
router.post('/reset-password', limiters.auth, validate({ body: s.setPasswordBody }), c.resetPassword);

router.get('/me', authenticate, c.me);
router.post('/change-password', authenticate, limiters.auth, validate({ body: s.changePasswordBody }), c.changePassword);
router.get('/sessions', authenticate, c.listSessions);
router.delete('/sessions/:id', authenticate, validate({ params: s.idParam }), c.revokeSession);

[
  ['post', '/auth/login', 'Sign in with email and password (sets the refresh + CSRF cookies)', false],
  ['post', '/auth/refresh', 'Rotate the refresh cookie and get a new access token (CSRF header required)', false],
  ['post', '/auth/logout', 'Sign out this device (CSRF header required)', false],
  ['post', '/auth/switch-context', 'Switch the active firm / platform context (CSRF header required)', false],
  ['post', '/auth/forgot-password', 'Request a password reset email (always 202)', false],
  ['get', '/auth/token-info', 'Check an invite / reset link', false],
  ['post', '/auth/accept-invite', 'Set the password from an invite link', false],
  ['post', '/auth/reset-password', 'Set a new password from a reset link', false],
  ['get', '/auth/me', 'Current user, active context, roles and permissions', true],
  ['post', '/auth/change-password', 'Change password (other devices are signed out)', true],
  ['get', '/auth/sessions', 'List signed-in devices', true],
  ['delete', '/auth/sessions/:id', 'Sign out a device', true],
].forEach(([method, path, summary, auth]) => documentRoute({ method, path, tag, summary, auth }));

export default router;
