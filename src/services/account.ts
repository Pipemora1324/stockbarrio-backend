import { config } from '../config.js';
import { database } from '../database.js';
import { badRequest, conflict, notFound } from '../errors.js';
import { accountTokenRepository, generateAccountToken, hashAccountToken } from '../repositories/account-token.js';
import { userRepository, type UserRecord } from '../repositories/user.js';
import { passwordDiffersFromEmail, passwordEqualsEmailMessage } from '../validation.js';
import { createToken, hashPassword, verifyPassword, type AuthUser } from './auth.js';
import { canSendMail, mailNotConfigured, sendMail } from './mailer.js';

export const genericResetMessage = 'Si el correo está registrado, te enviamos un enlace para cambiar la contraseña. Revisa tu bandeja de entrada y la carpeta de spam.';
const invalidLinkMessage = 'El enlace no es válido o ya venció. Pide uno nuevo.';

export const toAuthUser = (user: Pick<UserRecord, 'id' | 'name' | 'email' | 'role'> & { storeId?: string | null }): AuthUser => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  storeId: user.storeId ?? undefined,
});

// A fresh session for the user after a change that bumped the token version.
export const sessionFor = (user: UserRecord) => ({ token: createToken(toAuthUser(user), user.tokenVersion), user: toAuthUser(user) });

const sendInBackground = (message: Parameters<typeof sendMail>[0]) => {
  sendMail(message).catch((error: unknown) => console.error('No se pudo enviar un correo de la cuenta.', error instanceof Error ? error.message : error));
};

// Always answers the same way, whether the email exists or not, and sends in the background so timing does not tell either.
export const requestPasswordReset = async (email: string) => {
  if (!canSendMail()) throw mailNotConfigured();
  const user = await userRepository.getByEmail(email);
  if (!user) return;
  const token = generateAccountToken();
  await accountTokenRepository.createPasswordReset(user.id, hashAccountToken(token), config.accountTokenTtlMinutes);
  sendInBackground({
    to: user.email,
    subject: 'Cambia tu contraseña de StockBarrio',
    text: `Hola, ${user.name}:\n\nRecibimos una solicitud para cambiar la contraseña de tu cuenta. Abre este enlace en los próximos ${config.accountTokenTtlMinutes} minutos:\n\n${config.appUrl}/reset-password?token=${token}\n\nSi no fuiste tú, ignora este correo: tu contraseña no cambiará.\n\nEquipo de StockBarrio`,
  });
};

export const resetPassword = async (token: string, password: string) => {
  const passwordHash = await hashPassword(password);
  await database.withTransaction(async (client) => {
    const reset = await accountTokenRepository.consumePasswordReset(client, hashAccountToken(token));
    if (!reset) throw badRequest(invalidLinkMessage);
    const user = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [reset.userId]);
    if (!user.rows[0]) throw badRequest(invalidLinkMessage);
    if (!passwordDiffersFromEmail(password, user.rows[0].email)) throw badRequest(passwordEqualsEmailMessage);
    // The new hash and the token version change together, which signs out every previous session.
    await client.query('UPDATE users SET password_hash = $2, token_version = token_version + 1 WHERE id = $1', [reset.userId, passwordHash]);
    await accountTokenRepository.invalidatePasswordResets(client, reset.userId);
  });
};

const requireUser = async (userId: string) => {
  const user = await userRepository.getById(userId);
  if (!user) throw notFound('La cuenta no existe.');
  return user;
};

export const getProfile = async (userId: string) => {
  const user = await requireUser(userId);
  return { ...toAuthUser(user), pendingEmail: await accountTokenRepository.pendingEmailChange(userId) };
};

export const updateName = async (userId: string, name: string) => sessionFor((await userRepository.updateName(userId, name))!);

export const changePassword = async (userId: string, currentPassword: string, newPassword: string) => {
  const user = await requireUser(userId);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest('La contraseña actual no es correcta.');
  if (currentPassword === newPassword) throw badRequest('La nueva contraseña debe ser distinta de la actual.');
  if (!passwordDiffersFromEmail(newPassword, user.email)) throw badRequest(passwordEqualsEmailMessage);
  // The current session gets a new token; every other session stops working.
  return sessionFor((await userRepository.updatePassword(userId, await hashPassword(newPassword)))!);
};

export const requestEmailChange = async (userId: string, newEmail: string, currentPassword: string) => {
  if (!canSendMail()) throw mailNotConfigured();
  const user = await requireUser(userId);
  if (!(await verifyPassword(currentPassword, user.passwordHash))) throw badRequest('La contraseña actual no es correcta.');
  if (newEmail === user.email) throw badRequest('El correo nuevo es igual al actual.');
  if (await userRepository.getByEmail(newEmail)) throw conflict('Ese correo ya está en uso en otra cuenta.');
  const token = generateAccountToken();
  await accountTokenRepository.createEmailChange(userId, newEmail, hashAccountToken(token), config.accountTokenTtlMinutes);
  sendInBackground({
    to: newEmail,
    subject: 'Confirma tu nuevo correo en StockBarrio',
    text: `Hola, ${user.name}:\n\nPara usar este correo en tu cuenta de StockBarrio, abre este enlace en los próximos ${config.accountTokenTtlMinutes} minutos:\n\n${config.appUrl}/confirm-email?token=${token}\n\nSi no pediste este cambio, ignora este correo.\n\nEquipo de StockBarrio`,
  });
  sendInBackground({
    to: user.email,
    subject: 'Se pidió cambiar el correo de tu cuenta',
    text: `Hola, ${user.name}:\n\nAlguien con acceso a tu cuenta pidió cambiar el correo a ${newEmail}. El cambio solo se hará cuando se confirme desde ese correo.\nSi no fuiste tú, cambia tu contraseña cuanto antes.\n\nEquipo de StockBarrio`,
  });
};

export const confirmEmailChange = async (token: string) => {
  await database.withTransaction(async (client) => {
    const change = await accountTokenRepository.consumeEmailChange(client, hashAccountToken(token));
    if (!change) throw badRequest(invalidLinkMessage);
    const taken = await client.query('SELECT 1 FROM users WHERE email = $1 AND id <> $2', [change.newEmail, change.userId]);
    if (taken.rowCount) throw conflict('Ese correo ya está en uso en otra cuenta.');
    // The login email changed, so open sessions are closed and the user signs in again with the new one.
    await client.query('UPDATE users SET email = $2, token_version = token_version + 1 WHERE id = $1', [change.userId, change.newEmail]);
  });
};
