import { useEffect, useRef, useState, useCallback } from 'react';
import { loadFaceModels, analyzeFrame, areFaceModelsLoaded } from '../utils/faceAnalysis';

export function useFaceCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      const modelPromise = loadFaceModels();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 320 },
            height: { ideal: 240 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) {
              console.log('[useFaceCamera] Kamera redo, videoWidth:', videoRef.current?.videoWidth);
              setCameraReady(true);
            }
          };
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.name === 'NotAllowedError'
            ? 'Kamerabehörighet nekad'
            : err.name === 'NotFoundError'
              ? 'Ingen kamera hittades'
              : `Kamerafel: ${err.message}`;
          console.warn('[useFaceCamera]', msg);
          setCameraError(msg);
        }
        return;
      }

      await modelPromise;
      console.log('[useFaceCamera] Modeller klara, cameraReady kommer sättas till true');
    }

    initCamera();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      setCameraReady(false);
    };
  }, []);

  const captureAnalysis = useCallback(async () => {
    console.log('[useFaceCamera] captureAnalysis anropad — cameraReady:', cameraReady, '| modelsLoaded:', areFaceModelsLoaded(), '| videoRef:', !!videoRef.current);
    if (!cameraReady || !areFaceModelsLoaded()) return null;
    if (!videoRef.current) return null;

    try {
      return await analyzeFrame(videoRef.current);
    } catch (err) {
      console.warn('[useFaceCamera] captureAnalysis fel:', err.message);
      return null;
    }
  }, [cameraReady]);

  return { videoRef, captureAnalysis, cameraReady, cameraError };
}
