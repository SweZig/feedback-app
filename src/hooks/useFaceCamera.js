import { useEffect, useRef, useState } from 'react';
import { loadFaceModels, analyzeFrame, areFaceModelsLoaded } from '../utils/faceAnalysis';

/**
 * useFaceCamera
 *
 * Skaffar kamerastream + ansiktsmodeller och exponerar captureAnalysis().
 *
 * Sprint A.8.2 (race-fix): tidigare gjordes srcObject-tilldelningen och
 * onloadedmetadata-bindningen i SAMMA async-init-funktion som anropade
 * getUserMedia. Det gav en race condition:
 *
 *   getUserMedia (50-150 ms)  vs  fetchKioskData (200-800 ms)
 *
 * Om getUserMedia vann racet medan KioskPage fortfarande visade
 * "Laddar enkät..." (utan video-elementet i DOM:en) gick init förbi
 * `if (videoRef.current) {...}`, srcObject sattes aldrig, listener
 * attachades aldrig, cameraReady blev aldrig true. Plattan tappade då
 * face-data hela 4-timmarscykeln till nästa auto-reload — och eftersom
 * Sprint A.8 gjorde varje svar beroende av kameran syntes det som hela
 * dagar med 0% demografi.
 *
 * Fix: dela upp i två useEffects.
 *   1) Skaffa stream — en gång vid mount.
 *   2) Koppla stream till video-elementet så snart BÅDA finns, oavsett
 *      ordning. Effekten har inga deps och kör efter varje render, men
 *      kortsluter direkt om kopplingen redan är gjord.
 */
export function useFaceCamera() {
  const videoRef     = useRef(null);
  const streamRef    = useRef(null);
  const cancelledRef = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [faceStatus,  setFaceStatus]  = useState('init');

  // ── Effekt 1: skaffa stream + ladda modeller (en gång) ─────────────
  useEffect(() => {
    cancelledRef.current = false;
    loadFaceModels();

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
        if (cancelledRef.current) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        // Trigga en re-render så Effekt 2 kör och hittar streamen — viktigt
        // om video-elementet redan var mountat när vi nådde hit.
        setFaceStatus('stream-ready');
      } catch (err) {
        if (!cancelledRef.current) setFaceStatus('error:' + err.name);
      }
    })();

    return () => {
      cancelledRef.current = true;
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      setCameraReady(false);
    };
  }, []);

  // ── Effekt 2: koppla stream → video när båda är på plats ────────────
  // Kör efter varje render. Kortsluter på första raden så fort kopplingen
  // är gjord. Det här ersätter den tidigare inline-koden i init() som
  // bara körde EN gång — om video-elementet inte var mountat då (loading-
  // skärm visades) missade vi tillfället och plattan fastnade i fel state
  // 4 timmar.
  useEffect(() => {
    const el     = videoRef.current;
    const stream = streamRef.current;
    if (!el || !stream)            return;
    if (el.srcObject === stream)   return; // redan kopplat

    el.srcObject = stream;

    const handleMeta = () => {
      if (!cancelledRef.current) {
        setCameraReady(true);
        setFaceStatus('ready');
      }
    };
    el.addEventListener('loadedmetadata', handleMeta);

    // Edge: metadata kan redan ha fyrat (cached / instant) innan listenern
    // hann attachas. readyState ≥ 1 = HAVE_METADATA.
    if (el.readyState >= 1 && !cancelledRef.current) {
      setCameraReady(true);
      setFaceStatus('ready');
    }
  }); // medvetet utan deps — se kommentar ovan
  // eslint-disable-next-line react-hooks/exhaustive-deps

  async function captureAnalysis() {
    if (!cameraReady || !areFaceModelsLoaded() || !videoRef.current) return null;

    // Ge UI-tråden chans att rendera först
    await new Promise(r => setTimeout(r, 0));
    try {
      const result = await analyzeFrame(videoRef.current);
      if (result) setFaceStatus(result.ageGroup + '/' + result.gender);
      else        setFaceStatus('no-face');
      return result;
    } catch (err) {
      setFaceStatus('err:' + err.message);
      return null;
    }
  }

  return { videoRef, captureAnalysis, cameraReady, faceStatus };
}
