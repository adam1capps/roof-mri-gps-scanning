import Voice, { SpeechResultsEvent } from '@react-native-voice/voice';
import { PermissionsAndroid, Platform } from 'react-native';
import { gnssController } from '../app/GnssController';
import { parseVoiceCommand } from '../core/capture/voice';
import { useAppStore } from '../state/useAppStore';

/**
 * Hands-free reading entry: continuous listening for "<command> <number>"
 * (e.g. "mark seven"). Speech recognition sessions are finite on both
 * platforms, so the service restarts recognition after each final result or
 * end-of-speech until the contractor toggles the mic off.
 */

let running = false;
let restartTimer: ReturnType<typeof setTimeout> | null = null;

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const res = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
  );
  return res === PermissionsAndroid.RESULTS.GRANTED;
}

function handleResults(event: SpeechResultsEvent): void {
  const transcript = event.value?.[0];
  if (!transcript) return;
  const store = useAppStore.getState();
  store.setLastVoiceHeard(transcript);

  const command = parseVoiceCommand(transcript, store.settings.voiceCommandWords);
  if (!command) return;

  const error = gnssController.captureReading(command.value, 'voice');
  if (error) {
    store.setLastVoiceHeard(`✕ ${command.commandWord} ${command.value}: ${error}`);
  } else {
    store.setLastVoiceHeard(`✓ ${command.value} recorded`);
  }
}

function scheduleRestart(): void {
  if (!running) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!running) return;
    Voice.start('en-US').catch(() => scheduleRestart());
  }, 400);
}

export async function startVoiceCapture(): Promise<boolean> {
  if (running) return true;
  if (!(await requestMicPermission())) return false;

  Voice.onSpeechResults = handleResults;
  Voice.onSpeechEnd = () => scheduleRestart();
  Voice.onSpeechError = () => scheduleRestart();

  try {
    await Voice.start('en-US');
  } catch {
    return false;
  }
  running = true;
  useAppStore.getState().setVoiceActive(true);
  return true;
}

export async function stopVoiceCapture(): Promise<void> {
  running = false;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = null;
  try {
    await Voice.stop();
    await Voice.destroy();
  } catch {
    // already stopped
  }
  Voice.removeAllListeners();
  const store = useAppStore.getState();
  store.setVoiceActive(false);
  store.setLastVoiceHeard(null);
}
