import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0';

env.allowLocalModels = false;

let imageExtractorPromise;
let textExtractorPromise;

function getImageExtractor(progress_callback) {
  imageExtractorPromise ||= pipeline('image-feature-extraction', 'Xenova/clip-vit-base-patch32', { progress_callback });
  return imageExtractorPromise;
}
function getTextExtractor(progress_callback) {
  textExtractorPromise ||= pipeline('feature-extraction', 'Xenova/clip-vit-base-patch32', { progress_callback });
  return textExtractorPromise;
}

self.onmessage = async (event) => {
  const { type, id, payload } = event.data;
  try {
    if (type === 'embedImage') {
      const extractor = await getImageExtractor((x) => self.postMessage({ type: 'progress', id, payload: x }));
      const url = URL.createObjectURL(payload.file);
      const tensor = await extractor(url);
      URL.revokeObjectURL(url);
      self.postMessage({ type: 'embedding', id, vector: normalize(Array.from(tensor.data)) });
    } else if (type === 'embedText') {
      const extractor = await getTextExtractor((x) => self.postMessage({ type: 'progress', id, payload: x }));
      const tensor = await extractor(payload.text, { pooling: 'mean', normalize: true });
      self.postMessage({ type: 'textEmbedding', id, vector: normalize(Array.from(tensor.data)) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id, error: err?.message || String(err) });
  }
};

function normalize(v) {
  const mag = Math.hypot(...v) || 1;
  return v.map(x => x / mag);
}
