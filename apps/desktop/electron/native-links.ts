import { parseInviteLink as parseSharedInviteLink, type InviteLink } from '@rooms/social';
export type { InviteLink };

/** URL scheme of the desktop deep links the invitation page opens (`rooms://invite?…`). */
export const INVITE_SCHEME = 'rooms';
const SCHEME_PREFIX = new RegExp(`^${INVITE_SCHEME}:`, 'i');

/**
 * OS-delivered links carry their own server; bare tokens and web addresses are never accepted here.
 * The configured server is checked where it is known: the signed-in join only runs on the session's
 * own server (InviteLanding and the accept IPC), a signed-out link opens Kayıt ol for that host.
 */
export function parseInviteLink(raw: string): InviteLink | null {
  const value = raw.trim();
  return SCHEME_PREFIX.test(value) ? parseSharedInviteLink(value) : null;
}

/**
 * The invitation in a launch or `second-instance` command line. Windows starts the app as
 * `Tayfa.exe "rooms://invite?…"`, and Chromium may add or reorder switches around it, so only
 * well-formed `rooms:` links count; anything else on the command line is ignored.
 */
export function inviteFromArgv(argv: readonly string[]): InviteLink | null {
  for (const arg of argv) {
    if (typeof arg !== 'string' || !SCHEME_PREFIX.test(arg.trim())) continue;
    const invite = parseInviteLink(arg);
    if (invite) return invite;
  }
  return null;
}

interface ProtocolApp {
  isPackaged: boolean;
  isDefaultProtocolClient(protocol: string): boolean;
  setAsDefaultProtocolClient(protocol: string): boolean;
}

/**
 * Makes this install the handler for invitation links. macOS reads the scheme from Info.plist
 * (`build.protocols`), Windows from the registry the installer writes; registering again at launch
 * repairs a handler another install took over. Development runs never register: they would point
 * the scheme at the bare Electron binary.
 */
export function registerInviteProtocol(
  app: ProtocolApp,
  platform: NodeJS.Platform,
  profile: string | undefined,
): boolean {
  if (!app.isPackaged || profile || !['win32', 'darwin'].includes(platform)) return false;
  try {
    return app.isDefaultProtocolClient(INVITE_SCHEME) || app.setAsDefaultProtocolClient(INVITE_SCHEME);
  } catch {
    return false;
  }
}
