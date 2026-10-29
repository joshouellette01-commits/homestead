// glTF models from the Kenney Nature Kit (CC0, public/models/). Loaded once at
// startup and flattened into plain geometries per material, so views can draw
// them as instanced meshes in our own colours.
import { Box3, Matrix4, Mesh, Vector3, type BufferGeometry } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MODEL_FILES = {
  pine: 'tree_pineRoundA.glb',
  stump: 'stump_round.glb',
  log: 'log.glb',
} as const;

export type ModelId = keyof typeof MODEL_FILES;

/** One material's worth of a model, with the model's node transforms baked in. */
export interface ModelPart {
  geometry: BufferGeometry;
  /** The material name in the source file, e.g. "leafsDark" or "woodBark". */
  material: string;
}

export interface Model {
  parts: ModelPart[];
  /** Bounds of the whole model after baking. */
  size: Vector3;
}

export type Models = Record<ModelId, Model>;

async function load(loader: GLTFLoader, url: string): Promise<Model> {
  const gltf = await loader.loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  const parts: ModelPart[] = [];
  gltf.scene.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({ geometry: o.geometry.clone().applyMatrix4(o.matrixWorld), material: material?.name ?? '' });
  });
  const box = new Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    if (p.geometry.boundingBox) box.union(p.geometry.boundingBox);
  }
  // Sit the model on the ground.
  const lift = new Matrix4().makeTranslation(0, -box.min.y, 0);
  for (const p of parts) p.geometry.applyMatrix4(lift);
  return { parts, size: box.getSize(new Vector3()) };
}

export async function loadModels(baseUrl: string): Promise<Models> {
  const loader = new GLTFLoader();
  const entries = await Promise.all(
    (Object.keys(MODEL_FILES) as ModelId[]).map(async (id) => [id, await load(loader, `${baseUrl}models/${MODEL_FILES[id]}`)] as const),
  );
  const models: Partial<Models> = {};
  for (const [id, model] of entries) models[id] = model;
  const { pine, stump, log } = models;
  if (!pine || !stump || !log) throw new Error('a model failed to load');
  return { pine, stump, log };
}
