import { useState, useRef, useCallback } from 'react';

export interface VoiceRecording {
  blob: Blob;
  duration: number;
  url: string;
}

export function useVoiceRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      // Prefer webm/opus, fall back to whatever is available
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.start(100); // Collect data every 100ms
      startTimeRef.current = Date.now();
      setIsRecording(true);
      setRecordingDuration(0);

      timerRef.current = setInterval(() => {
        setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);

      return true;
    } catch (e) {
      console.error('Microphone access denied:', e);
      return false;
    }
  }, []);

  const stopRecording = useCallback((): Promise<VoiceRecording | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }

      recorder.onstop = () => {
        const duration = Math.floor((Date.now() - startTimeRef.current) / 1000);
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
        const url = URL.createObjectURL(blob);

        // Stop all tracks
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;

        setIsRecording(false);
        setRecordingDuration(0);

        if (duration < 1 || blob.size < 1000) {
          URL.revokeObjectURL(url);
          resolve(null); // Too short
          return;
        }

        resolve({ blob, duration, url });
      };

      recorder.stop();
    });
  }, []);

  const cancelRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.onstop = null;
      mediaRecorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
    setRecordingDuration(0);
  }, []);

  return { isRecording, recordingDuration, startRecording, stopRecording, cancelRecording };
}
