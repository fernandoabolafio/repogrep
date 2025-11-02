import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const MODEL_REVISION = 'main';
const EMBEDDING_DIMENSION = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL_ID, {
      revision: MODEL_REVISION
    }) as Promise<FeatureExtractionPipeline>;
  }
  return extractorPromise;
}

export function getEmbeddingDimension(): number {
  return EMBEDDING_DIMENSION;
}

export async function embedText(text: string): Promise<Float32Array> {
  const extractor = await getExtractor();
  const input = text.trim().length === 0 ? ' ' : text;
  const output = await extractor(input, { pooling: 'mean', normalize: true });

  if (output instanceof Float32Array) {
    return output;
  }

  if (Array.isArray(output)) {
    return Float32Array.from(output.flat());
  }

  if (typeof output === 'object' && output !== null && 'data' in output) {
    const data = (output as { data: Float32Array | number[] }).data;
    return data instanceof Float32Array ? data : Float32Array.from(data);
  }

  throw new Error('Unexpected embedding output format from transformers pipeline');
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const extractor = await getExtractor();
  const sanitized = texts.map((text) => (text.trim().length === 0 ? ' ' : text));
  const outputs = await extractor(sanitized, { pooling: 'mean', normalize: true });

  if (Array.isArray(outputs)) {
    return outputs.map((value) => {
      if (value instanceof Float32Array) {
        return value;
      }
      if (Array.isArray(value)) {
        return Float32Array.from(value.flat());
      }
      if (value && typeof value === 'object' && 'data' in value) {
        const data = (value as { data: Float32Array | number[] }).data;
        return data instanceof Float32Array ? data : Float32Array.from(data);
      }
      throw new Error('Unexpected batched embedding output format');
    });
  }

  if (outputs instanceof Float32Array) {
    return [outputs];
  }

  if (outputs && typeof outputs === 'object' && 'data' in outputs) {
    const data = (outputs as { data: Float32Array | number[] }).data;
    return [data instanceof Float32Array ? data : Float32Array.from(data)];
  }

  throw new Error('Unexpected embedding output format from transformers pipeline');
}
