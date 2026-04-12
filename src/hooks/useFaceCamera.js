/**
 * useFaceCamera.js
 * ───────────────────────────────────────────────────────────────────────────
 * Custom hook som hanterar kamerans livscykel och exponerar captureAnalysis().
 *
 * Användning i KioskPage:
 *
 *   const { videoRef, captureAnalysis, cameraReady } = useFaceCamera();
 *
 *   // I JSX — dold videoelement för kameraström:
 *   <video ref={videoRef} autoPlay muted playsInline style={{ display: 'none' }} />
 *
 *   // Vid score-val:
 *   const result = await captureAnalysis();
 *   if (result?.isDuplicate) { ...visa meddelande eller ignorera... }
 *   // result?.ageGroup och result?.gender sparas med svaret
 * ───────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadFaceModels, analyzeFrame, areFaceModelsLoaded } from '../utils/faceAnalysis';

/**
 * @returns {{
 *   videoRef:        React.RefObject<HTMLVideoElement>,
 *   captureAnalysis: () => Promise<AnalysisResult|null>,
 *   cameraReady:     boolean,
 *   cameraError:     string|null,
 * }}
 */
export function useFaceCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      // Ladda modeller parallellt med kamerastart
      const modelPromise = loadFaceModels();

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',   // Frontkamera
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
            if (!cancelled) setCameraReady(true);
          };
        }
      } catch (err) {
        if (!cancelled) {
          // Vanliga felkoder: NotAllowedError, NotFoundError, NotReadableError
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

      // Vänta på att modeller laddas (sker parallellt med kamerastart)
      await modelPromise;
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

  /**
   * Tar en snapshot från videoströmmen och analyserar den.
   * Anropas precis när användaren trycker på ett NPS-betyg.
   *
   * Returnerar null om kamera inte är redo eller inget ansikte hittas.
   * Appen ska alltid tillåta svaret att gå igenom — demografi är frivillig data.
   */
  const captureAnalysis = useCallback(async () => {
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
