// Web permissions the renderer may use. Granted only to the app's own main frame in the app window.
// `midi` is Web MIDI without SysEx (Studio MIDI keyboards: note/controller input). `midiSysex` stays
// denied: SysEx messages can rewrite device settings and firmware.
export const RENDERER_PERMISSIONS: ReadonlySet<string> = new Set([
  'media',
  'fullscreen',
  'clipboard-sanitized-write',
  'midi',
]);

export interface PermissionContext {
  isMainFrame: boolean;
  /** The URL of the frame asking; required. */
  requestingUrl: string | undefined;
  /** The URL currently loaded in the asking WebContents. */
  contentsUrl: string;
  /** True when the asking WebContents is the app window's own. */
  ownWindow: boolean;
  isTrusted: (url: string) => boolean;
}

export function isRendererPermissionAllowed(permission: string, context: PermissionContext): boolean {
  return (
    context.isMainFrame &&
    context.ownWindow &&
    !!context.requestingUrl &&
    context.isTrusted(context.requestingUrl) &&
    context.isTrusted(context.contentsUrl) &&
    RENDERER_PERMISSIONS.has(permission)
  );
}
