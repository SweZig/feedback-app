/**
 * faceAnalysis.js
 * ───────────────────────────────────────────────────────────────────────────
 * Ansiktsanalys för KioskPage — demografi + deduplikering.
 *
 * Arkitekturprinciper (GDPR):
 *  • Råbild lämnar ALDRIG RAM — inget sparas till disk eller nätverk
 *  • Landmarks normaliseras till Float32Array (descriptor) — inte en bild
 *  • Descriptors sparas max DEDUP_TTL_MS i minnet, sedan garbage-collectade
 *  • Demografidata (åldersgrupp + kön) skickas som anonyma kategorier till Supabase
 * ───────────────────────────────────────────────────────────────────────────
 */

import * as faceapi from '@vladmandic/face-api';

// Modeller laddas från public/models/ (se download-face-models.ps1)
const MODEL_PATH = process.env.PUBLIC_URL + '/models';

// Deduplikering: poster äldre än 5 min rensas automatiskt
const DEDUP_TTL_MS = 5 * 60 * 1000;

// Euklidiskt avstånd-tröskel för landmark-descriptor.
// 0.0 = exakt match, 1.0 = helt olika.
// 0.38 ger bra balans för kiosk-avstånd (~50–100 cm från kamera).
const SIMILARITY_THRESHOLD = 0.38;

// ─── Intern state ─────────────────────────────────────────────────────────────

let modelsLoaded = false;
let modelsLoading = false;

// Cirkulär in-memory cache — aldrig persisterad
// Struktur: [{descriptor: Float32Array, timestamp: number}]
const _cache = [];

// ─── Modell-laddning ──────────────────────────────────────────────────────────

/**
 * Laddar de tre modellerna från public/models/.
 * Anropas en gång (idempotent) — typiskt vid KioskPage mount.
 * @returns {Promise<void>}
 */
export async function loadFaceModels() {
  if (modelsLoaded || modelsLoading) return;
  modelsLoading = true;
  try {
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_PATH),
      faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_PATH),
      faceapi.nets.ageGenderNet.loadFromUri(MODEL_PATH),
    ]);
    modelsLoaded = true;
    console.log('[faceAnalysis] Modeller laddade OK');
  } catch (err) {
    console.warn('[faceAnalysis] Kunde inte ladda modeller:', err.message);
  } finally {
    modelsLoading = false;
  }
}

export function areFaceModelsLoaded() {
  return modelsLoaded;
}

// ─── Cache-hantering ──────────────────────────────────────────────────────────

/** Rensar poster äldre än DEDUP_TTL_MS. Anropas internt före varje analys. */
function pruneCache() {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  // Posten är sorterade i insättningsordning — ta bort från fronten
  while (_cache.length > 0 && _cache[0].timestamp < cutoff) {
    _cache.shift();
  }
}

/** Manuell rensning — t.ex. vid admin-reset. */
export function clearFaceCache() {
  _cache.length = 0;
}

/** Antal aktiva poster i cachen (för debug/test). */
export function cacheSize() {
  pruneCache();
  return _cache.length;
}

// ─── Interna hjälpfunktioner ──────────────────────────────────────────────────

/**
 * Normaliserar 68 landmarks till ett 136-dimensionellt Float32Array.
 * Koordinaterna normaliseras relativt ansiktets bounding box
 * så att descriptor är rotations- och skalinvariant.
 */
function buildDescriptor(landmarks) {
  const pts = landmarks.positions;
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const rangeX = (Math.max(...xs) - minX) || 1;
  const rangeY = (Math.max(...ys) - minY) || 1;

  return new Float32Array(
    pts.flatMap(p => [
      (p.x - minX) / rangeX,
      (p.y - minY) / rangeY,
    ])
  );
}

/** Euklidiskt avstånd mellan två Float32Array av samma längd. */
function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i] - b[i]) ** 2;
  }
  return Math.sqrt(sum);
}

/** Mappar numerisk ålder → svensk ålderskategori. */
function toAgeGroup(age) {
  if (age < 13) return 'barn';
  if (age < 26) return 'ungdom';
  if (age < 61) return 'vuxen';
  return 'äldre';
}

/**
 * Mappar face-api.js gender + probability → 'man' | 'kvinna' | 'okänt'.
 * Under 65% confidence → 'okänt' för att undvika felklassificering.
 */
function toGender(gender, probability) {
  if (probability < 0.65) return 'okänt';
  return gender === 'male' ? 'man' : 'kvinna';
}

// ─── Huvud-API ────────────────────────────────────────────────────────────────

/**
 * Analyserar en videoframe.
 *
 * @param {HTMLVideoElement} videoEl  - Live kamera-ström
 * @returns {Promise<AnalysisResult|null>}
 *
 * AnalysisResult: {
 *   isDuplicate: boolean      — true = samma person svarade nyligen (< 5 min)
 *   ageGroup:    string       — 'barn' | 'ungdom' | 'vuxen' | 'äldre'
 *   gender:      string       — 'man' | 'kvinna' | 'okänt'
 *   confidence:  number       — detektionssäkerhet 0–1
 *   rawAge:      number       — rå åldersestimering (för debug)
 * }
 *
 * Returnerar null om:
 *  - Modeller inte laddade
 *  - Inget ansikte detekteras i framen
 *  - videoEl saknas
 */
export async function analyzeFrame(videoEl) {
  if (!modelsLoaded || !videoEl) return null;

  // Kontrollera att video faktiskt streamar (undviker analys på svart frame)
  console.log('[faceAnalysis] videoEl.readyState:', videoEl.readyState, 'videoWidth:', videoEl.videoWidth);
  if (videoEl.readyState < 2) return null;

  let result;
  try {
    result = await faceapi
      .detectSingleFace(
        videoEl,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,       // Balans mellan precision och hastighet
          scoreThreshold: 0.3,  // Sänkt för bättre detektering
        })
      )
      .withFaceLandmarks(true)  // tiny-modellen (80 KB)
      .withAgeAndGender();
  } catch (err) {
    console.warn('[faceAnalysis] Analysfel:', err.message);
    return null;
  }

  console.log('[faceAnalysis] detectSingleFace resultat:', result);
  if (!result) return null;

  // Bygg descriptor från normaliserade landmarks
  const descriptor = buildDescriptor(result.landmarks);

  // Rensa gamla poster och kontrollera duplikat
  pruneCache();
  const isDuplicate = _cache.some(
    entry => euclidean(entry.descriptor, descriptor) < SIMILARITY_THRESHOLD
  );

  // Lägg till i cache om inte duplikat (ny unik person)
  if (!isDuplicate) {
    _cache.push({ descriptor, timestamp: Date.now() });
  }

  return {
    isDuplicate,
    ageGroup: toAgeGroup(result.age),
    gender: toGender(result.gender, result.genderProbability),
    confidence: parseFloat(result.detection.score.toFixed(3)),
    rawAge: Math.round(result.age), // Används ej i Supabase — bara för debug
  };
}
