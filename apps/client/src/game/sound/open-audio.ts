import workletUrl from "./worklet.ts?worker&url";

export function openAudio(): AudioContext {
  const context = new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48000,
  });
  void context.audioWorklet.addModule(workletUrl).catch(() => undefined);
  return context;
}

export function soundModule(context: AudioContext): Promise<void> {
  return context.audioWorklet.addModule(workletUrl);
}
