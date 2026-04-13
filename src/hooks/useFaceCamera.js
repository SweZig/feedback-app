/**
 * useFaceCamera.js
 *
 * Dubbelt läge:
 *  1. Fully Kiosk Browser — fully.getCamshot() anropas direkt vid capture
 *  2. Vanlig webbläsare   — getUserMedia + video-element
 *
 * Fully-detektering sker vid capture-tillfället, inte vid init.
 * Ingen fördröjning behövs.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { loadFaceModels, analyzeFrame, analyzeImage, areFaceModelsLoaded } from '../utils/faceAnalysis';

export function useFaceCamera() {
  const videoRef   = useRef(null);
  const streamRef  = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState(null);
  const [faceStatus, setFaceStatus] = useState('init'); // init | ready-fully | ready-cam | error | no-face

  useEffect(() => {
    let cancelled = false;

    async function initCamera() {
      // Ladda modeller alltid
      const modelPromise = loadFaceModels();

      // Om Fully finns — ingen videoström behövs
      if (typeof window.fully !== 'undefined') {
        console.log('[useFaceCamera] Fully detekterad vid init');
        await modelPromise;
        if (!cancelled) { setCameraReady(true); setFaceStatus('ready-fully'); }
        return;
      }

      // Webbläsar-läge: getUserMedia
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });

        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            if (!cancelled) {
              console.log('[useFaceCamera] Kamera redo, videoWidth:', videoRef.current?.videoWidth);
              setCameraReady(true);
              setFaceStatus('ready-cam');
            }
          };
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err.name === 'NotAllowedError' ? 'Kamerabehörighet nekad'
            : err.name === 'NotFoundError' ? 'Ingen kamera hittades'
            : `Kamerafel: ${err.message}`;
          console.warn('[useFaceCamera]', msg);
          setCameraError(msg);
          setFaceStatus('error');
          await modelPromise;
          if (!cancelled) setCameraReady(true);
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
    alert('captureAnalysis anropad, modeller: ' + areFaceModelsLoaded() + ', fully: ' + (typeof window.fully));
    if (!areFaceModelsLoaded()) {
      return null;
    }

    // Fully-läge — kontrollera vid capture-tillfället
    if (typeof window.fully !== 'undefined' && typeof window.fully.getCamshot === 'function') {
      const base64 = window.fully.getCamshot();
      alert('getCamshot: ' + (base64 ? base64.substring(0, 50) : 'NULL/TOM'));
      if (!base64) { setFaceStatus('no-face'); return null; }

      return await new Promise((resolve) => {
        const img = new Image();
        img.onload  = async () => resolve(await analyzeImage(img));
        img.onerror = () => { console.warn('[useFaceCamera] base64-bild laddades ej'); resolve(null); };
        img.src = base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
      });
    }

    // Webbläsar-läge
    if (!videoRef.current) return null;
    return await analyzeFrame(videoRef.current);
  }, []);

  return { videoRef, captureAnalysis, cameraReady, cameraError, faceStatus };
}
