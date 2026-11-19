import { z } from 'zod';
import { passwordSchema } from '../../services/password.js';

const email = z.string().trim().toLowerCase().max(254).email('Enter a valid email');
const token = z.string().min(20).max(200);

const loginBody = z.strictObject({
  email,
  password: z.string().min(1, 'Password is required').max(128),
  firmId: z.union([z.uuid(), z.literal('platform')]).optional(),
});
const forgotBody = z.strictObject({ email });
const tokenQuery = z.strictObject({ token, purpose: z.enum(['INVITE', 'PASSWORD_RESET']) });
const setPasswordBody = z.strictObject({ token, password: passwordSchema });
const changePasswordBody = z.strictObject({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema });
const switchContextBody = z.strictObject({ firmId: z.union([z.uuid(), z.literal('platform')]) });
const idParam = z.strictObject({ id: z.uuid() });

export { loginBody, forgotBody, tokenQuery, setPasswordBody, changePasswordBody, switchContextBody, idParam };
