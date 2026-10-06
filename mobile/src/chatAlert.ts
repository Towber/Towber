import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const chime = require('../assets/sounds/new-job.wav');
let player: AudioPlayer | null = null;

/** Play a short audible and haptic alert for an incoming chat message. */
export async function playIncomingChatAlert() {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    // Haptics still provide feedback if audio mode cannot be configured.
  }

  try {
    if (!player) {
      player = createAudioPlayer(chime);
      player.loop = false;
      player.volume = 0.8;
    }
    await player.seekTo(0);
    player.play();
  } catch {
    // Keep the notification useful even if audio playback is unavailable.
  }

  Vibration.vibrate([0, 120, 80, 120]);
}

export function releaseIncomingChatAlert() {
  try {
    player?.remove();
  } catch {
    // Ignore cleanup errors while the app is unmounting.
  }
  player = null;
}
