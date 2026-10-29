import workletUrl from './mic-gate-worklet.ts?worker&url';
import { micGateSettings, type MicGateReport, type MicGateSettings } from './mic-gate';
export type MicGateNode = AudioWorkletNode & {
  configure(settings: MicGateSettings): void;
  destroy(): void;
};
const modules = new WeakMap<BaseAudioContext, Promise<void>>();
/**
 * The input gate on the audio thread. Resolves to null when this engine has no AudioWorklet
 * (the microphone is then sent ungated, as before). `onState` fires when it opens or closes,
 * `onLevel` about 20 times a second; `onFailure` when the processor stops (the caller must bypass it).
 */
export async function createMicGateNode(
  context: BaseAudioContext,
  settings: MicGateSettings,
  callbacks: {
    onState?(report: MicGateReport): void;
    onLevel?(report: MicGateReport): void;
    onFailure?(): void;
    /** Only measure (no audio output); used by the Settings microphone test. */
    meterOnly?: boolean;
  } = {},
): Promise<MicGateNode | null> {
  if (typeof AudioWorkletNode !== 'function' || !context.audioWorklet) return null;
  let module = modules.get(context);
  if (!module) {
    module = context.audioWorklet.addModule(workletUrl).catch((error) => {
      modules.delete(context);
      throw error;
    });
    modules.set(context, module);
  }
  try {
    await module;
  } catch {
    return null;
  }
  const node = new AudioWorkletNode(context, 'rooms-mic-gate', {
    numberOfInputs: 1,
    numberOfOutputs: callbacks.meterOnly ? 0 : 1,
    ...(callbacks.meterOnly ? {} : { outputChannelCount: [1] }),
    channelCount: 1,
    channelCountMode: 'explicit',
    processorOptions: micGateSettings(settings),
  }) as MicGateNode;
  let disposed = false;
  node.port.onmessage = (event) => {
    const data = event.data as (MicGateReport & { type?: string }) | undefined;
    if (!data || disposed) return;
    const report = { open: !!data.open, level: data.level, threshold: data.threshold };
    if (data.type === 'state') callbacks.onState?.(report);
    else if (data.type === 'level') callbacks.onLevel?.(report);
  };
  node.addEventListener('processorerror', () => {
    if (!disposed) callbacks.onFailure?.();
  });
  node.configure = (next) => {
    if (!disposed) node.port.postMessage({ type: 'settings', settings: micGateSettings(next) });
  };
  node.destroy = () => {
    if (disposed) return;
    disposed = true;
    node.port.postMessage({ type: 'destroy' });
    node.disconnect();
    node.port.close();
  };
  return node;
}
