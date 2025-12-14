export interface AudioStreamConfig {
  sampleRate: number;
}

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export type AtmosphereState = 'default' | 'focus' | 'calm' | 'energy' | 'alert' | 'stranger';

export interface VisualizerProps {
  analyser: AnalyserNode | null;
  isActive: boolean;
  mood: AtmosphereState;
}

export interface SessionRecord {
  id: string;
  timestamp: number;
  durationSeconds: number;
  mood: AtmosphereState;
}

export interface NotificationState {
  visible: boolean;
  message: string;
  type: 'info' | 'success' | 'warning';
}