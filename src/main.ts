import { content } from './content';
import { World } from './render/scene';

const container = document.getElementById('app');
if (!container) throw new Error('#app missing from index.html');

const world = new World(container, content);

function resize(): void {
  world.resize(container!.clientWidth, container!.clientHeight);
}
resize();
window.addEventListener('resize', resize);

world.renderer.setAnimationLoop(() => world.render());
