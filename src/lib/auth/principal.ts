import { authServer, authorizedEmail } from './server';
import { cookieToken, createDevice, deviceCookie, readDevice } from './device';
import { databasePool } from '../postgres';
export async function authenticate(request: Request) {
  const db = databasePool();
  let token = cookieToken(request);
  let device = await readDevice(db, token);
  if (!device) {
    const { data: session } = await authServer().getSession();
    if (!session?.user || !session.user.emailVerified || !authorizedEmail(session.user.email))
      return null;
    const user = {
      id: session.user.id,
      email: session.user.email.toLowerCase(),
      name: session.user.name,
    };
    const created = await createDevice(db, user);
    token = created.token;
    device = { deviceId: created.id, user };
  }
  if (!authorizedEmail(device.user.email)) return null;
  return {
    ...device,
    finish(response: Response) {
      // Refresh browser retention on every authenticated visit, even after the identity-provider session expires.
      response.headers.append('Set-Cookie', deviceCookie(token!));
      response.headers.set('Cache-Control', 'no-store');
      return response;
    },
  };
}
