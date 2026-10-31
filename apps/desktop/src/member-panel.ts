/**
 * Where the community members show. Wide windows dock them beside a channel, open until
 * closed (like Discord), and remember that; narrow windows and pages without a channel use
 * the drawer, which closes on navigation.
 */
export function memberPanel(state: {
  narrow: boolean;
  /** A community text channel or voice room is open. */
  channel: boolean;
  settings: boolean;
  /** The remembered choice (`memberPanel` preference). */
  docked: boolean;
  drawerOpen: boolean;
}) {
  const drawer = state.narrow || !state.channel;
  const docked = !drawer && state.docked && !state.settings;
  return {
    docked,
    visible: drawer ? state.drawerOpen : docked,
    /** The members button toggles the drawer, or the remembered docked panel. */
    toggles: drawer ? ('drawer' as const) : ('docked' as const),
  };
}
