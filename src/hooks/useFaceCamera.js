import { useEffect, useRef, useState } from 'react';
import { loadFaceModels, analyzeFrame, areFaceModelsLoaded } from '../utils/faceAnalysis';

export function useFaceCamera() {
  const videoRef  = useRef(null);
  const streamRef = useRef(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [faceStatus, setFaceStatus]   = useState('init');

  useEffect(() => {
    let cancelled = false;

    async function init() {
      loadFaceModels();

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
            if (!cancelled) { setCameraReady(true); setFaceStatus('ready'); }
          };
        }
      } catch (err) {
        if (!cancelled) setFaceStatus('error:' + err.name);
      }
    }

    init();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, []);

  async function captureAnalysis() {
    if (!cameraReady || !areFaceModelsLoaded() || !videoRef.current) return null;
    try {
      const result = await analyzeFrame(videoRef.current);
      if (result) setFaceStatus(result.ageGroup + '/' + result.gender);
      else setFaceStatus('no-face');
      return result;
    } catch (err) {
      setFaceStatus('err:' + err.message);
      return null;
    }
  }

  return { videoRef, captureAnalysis, cameraReady, faceStatus };
}
