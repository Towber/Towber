import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// Looping "new job" chime + vibration for a partner while an offer is waiting.
// Sound is a nice-to-have: if audio fails for any reason, vibration still alerts the partner.
const chime = require('../assets/sounds/new-job.wav');
let player: AudioPlayer | null = null;

export async function startJobAlert() {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {
    /* keep going */
  }
  try {
    if (!player) {
      player = createAudioPlayer(chime);
      player.loop = true;
      player.volume = 1;
    }
    await player.seekTo(0);
    player.play();
  } catch {
    /* vibration below still fires */
  }
  Vibration.vibrate([0, 600, 450, 600, 1500], true);
}

export function stopJobAlert() {
  try { player?.pause(); } catch { /* ignore */ }
  Vibration.cancel();
}

export function releaseJobAlert() {
  stopJobAlert();
  try { player?.remove(); } catch { /* ignore */ }
  player = null;
}
