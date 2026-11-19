import * as auth from './auth.service.js';
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './sessions.js';

/** Thin HTTP layer: input is already validated; business rules live in auth.service.js. */

async function login(req, res) {
  const { accessToken, refreshToken } = await auth.login(req.valid.body, req);
  setAuthCookies(res, refreshToken);
  res.json({ accessToken });
}

async function refresh(req, res) {
  try {
    const { accessToken, refreshToken } = await auth.refresh(req.cookies?.[REFRESH_COOKIE], req);
    if (refreshToken) setAuthCookies(res, refreshToken);
    res.json({ accessToken });
  } catch (e) {
    if (e.status === 401) clearAuthCookies(res);
    throw e;
  }
}

async function logout(req, res) {
  await auth.logout(req.cookies?.[REFRESH_COOKIE], req);
  clearAuthCookies(res);
  res.status(204).end();
}

async function switchContext(req, res) {
  const { accessToken, refreshToken } = await auth.switchContext(req.cookies?.[REFRESH_COOKIE], req.valid.body, req);
  setAuthCookies(res, refreshToken);
  res.json({ accessToken });
}

const me = async (req, res) => res.json(await auth.me(req.principal));

async function forgotPassword(req, res) {
  const dev = await auth.forgotPassword(req.valid.body);
  res.status(202).json({ message: 'If an account exists for this email, a reset link has been sent.', ...dev });
}

const tokenInfo = async (req, res) => res.json(await auth.tokenInfo(req.valid.query));

async function acceptInvite(req, res) {
  await auth.completePasswordToken(req.valid.body, 'INVITE', req);
  res.json({ message: 'Your password has been set. You can now sign in.' });
}

async function resetPassword(req, res) {
  await auth.completePasswordToken(req.valid.body, 'PASSWORD_RESET', req);
  res.json({ message: 'Your password has been reset. You can now sign in.' });
}

async function changePassword(req, res) {
  await auth.changePassword(req.principal, req.valid.body, req);
  res.json({ message: 'Password changed. Other devices have been signed out.' });
}

const listSessions = async (req, res) => res.json({ items: await auth.listSessions(req.principal) });

async function revokeSession(req, res) {
  const { current } = await auth.revokeSession(req.principal, req.valid.params.id, req);
  if (current) clearAuthCookies(res);
  res.status(204).end();
}

export { login, refresh, logout, switchContext, me, forgotPassword, tokenInfo, acceptInvite, resetPassword, changePassword, listSessions, revokeSession };
