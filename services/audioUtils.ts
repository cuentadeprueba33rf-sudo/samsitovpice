import { Blob } from '@google/genai';

export const AUDIO_INPUT_SAMPLE_RATE = 16000;
export const AUDIO_OUTPUT_SAMPLE_RATE = 24000;

/**
 * Decodes base64 string to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encodes Uint8Array to base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Float32Array (Web Audio API) to PCM Int16Array (Gemini API) and wraps in Blob
 */
export function createAudioBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    // Clamp values to [-1, 1] before scaling
    const sample = Math.max(-1, Math.min(1, data[i]));
    int16[i] = sample * 32768;
  }
  return {
    data: bytesToBase64(new Uint8Array(int16.buffer)),
    mimeType: `audio/pcm;rate=${AUDIO_INPUT_SAMPLE_RATE}`,
  };
}

/**
 * Decodes raw PCM Int16 bytes from Gemini to an AudioBuffer
 */
export function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = AUDIO_OUTPUT_SAMPLE_RATE,
  numChannels: number = 1,
): AudioBuffer {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}