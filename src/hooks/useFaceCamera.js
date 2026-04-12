/**
 * useFaceCamera.js
 *
 * Dubbelt läge:
 *  1. Fully Kiosk Browser (Android) — använder fully.getCamshot() via JavaScript API
 *  2. Vanlig webbläsare (PC/Chrome) — använder getUserMedia + video-element
 *
 * captureAnalysis() returnerar alltid samma format oavsett läge.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadFaceModels, analyzeFrame, analyzeImage, areFaceModelsLoaded } from '../utils/faceAnalysis';

// Kontrollera om vi kör i Fully Kiosk Browser
function isFullyKiosk() {
  return typeof window.fully !== 'undefined' && typeof window.fully.getCamshot === 'function';
}

export function useFaceCamera() {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [usingFully, setUsingFully] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      // Ladda modeller alltid
      const modelPromise = loadFaceModels();

      if (isFullyKiosk()) {
        // ── Fully-läge: ingen videoström behövs ──
        console.log('[useFaceCamera] Fully Kiosk detekterad — använder getCamshot()');
        setUsingFully(true);
        await modelPromise;
        if (!cancelled) setCameraReady(true);
        return;
      }

      // ── Webbläsar-läge: getUserMedia ──
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
      console.log('[useFaceCamera] Modeller klara');
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
    console.log('[useFaceCamera] captureAnalysis — cameraReady:', cameraReady, '| fully:', usingFully, '| modelsLoaded:', areFaceModelsLoaded());
    if (!cameraReady || !areFaceModelsLoaded()) return null;

    try {
      if (usingFully) {
        // ── Fully-läge: hämta base64-bild från Fully's kamera ──
        const base64 = window.fully.getCamshot();
        console.log('[useFaceCamera] getCamshot returnerade:', base64 ? `${base64.length} tecken` : 'null/tom');
        if (!base64) return null;

        // Skapa Image-element från base64
        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = async () => {
            const result = await analyzeImage(img);
            console.log('[useFaceCamera] analyzeImage resultat:', result);
            resolve(result);
          };
          img.onerror = () => {
            console.warn('[useFaceCamera] Kunde inte ladda base64-bild');
            resolve(null);
          };
          img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
        });
      } else {
        // ── Webbläsar-läge: videoframe ──
        if (!videoRef.current) return null;
        return await analyzeFrame(videoRef.current);
      }
    } catch (err) {
      console.warn('[useFaceCamera] captureAnalysis fel:', err.message);
      return null;
    }
  }, [cameraReady, usingFully]);

  return { videoRef, captureAnalysis, cameraReady, cameraError };
}
