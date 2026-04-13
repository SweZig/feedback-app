/**
 * faceAnalysis.js
 */

import * as faceapi from '@vladmandic/face-api';

const MODEL_PATH = process.env.PUBLIC_URL + '/models';
const DEDUP_TTL_MS = 5 * 60 * 1000;
const SIMILARITY_THRESHOLD = 0.38;

let modelsLoaded = false;
let modelsLoading = false;
const _cache = [];

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

function pruneCache() {
  const cutoff = Date.now() - DEDUP_TTL_MS;
  while (_cache.length > 0 && _cache[0].timestamp < cutoff) {
    _cache.shift();
  }
}

export function clearFaceCache() {
  _cache.length = 0;
}

export function cacheSize() {
  pruneCache();
  return _cache.length;
}

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

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function toAgeGroup(age) {
  if (age < 13) return 'barn';
  if (age < 26) return 'ungdom';
  if (age < 61) return 'vuxen';
  return 'äldre';
}

function toGender(gender, probability) {
  if (probability < 0.65) return 'okänt';
  return gender === 'male' ? 'man' : 'kvinna';
}

export async function analyzeFrame(videoEl) {
  if (!modelsLoaded || !videoEl) return null;

  if (videoEl.readyState < 2 || !videoEl.videoWidth) return null;

  // Rita videoframe till canvas — mer pålitligt än dolt video-element
  const canvas = document.createElement('canvas');
  canvas.width  = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

  let result;
  try {
    result = await faceapi
      .detectSingleFace(
        canvas,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.3,
        })
      )
      .withFaceLandmarks(true)
      .withAgeAndGender();
  } catch (err) {
    console.warn('[faceAnalysis] Analysfel:', err.message);
    return null;
  }

  if (!result) return null;

  const descriptor = buildDescriptor(result.landmarks);

  pruneCache();
  const isDuplicate = _cache.some(
    entry => euclidean(entry.descriptor, descriptor) < SIMILARITY_THRESHOLD
  );

  if (!isDuplicate) {
    _cache.push({ descriptor, timestamp: Date.now() });
  }

  return {
    isDuplicate,
    ageGroup: toAgeGroup(result.age),
    gender: toGender(result.gender, result.genderProbability),
    confidence: parseFloat(result.detection.score.toFixed(3)),
    rawAge: Math.round(result.age),
  };
}
