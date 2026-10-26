// Studio editors (arrangement, piano roll, drum steps). The shell renders <StudioEditors port={…}>
// inside its <BoardUiRoot> and adapts the Studio store to EditorPort (port.ts).
export { StudioEditors, randomId, type StudioEditorsProps, type DetailView } from './StudioEditors';
export {
  ArrangementTimeline,
  ARRANGEMENT_LABEL_WIDTH,
  ARRANGEMENT_LANE_HEIGHT,
  ARRANGEMENT_RULER_HEIGHT,
} from './ArrangementTimeline';
export { PianoRoll } from './PianoRoll';
export { StepSequencer } from './StepSequencer';
export { chartToken } from './colors';
export type { EditorLoop, EditorPort, EditorPresence, EditorSelection } from './port';
