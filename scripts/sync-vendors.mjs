import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('apps/web/vendor/three',{recursive:true});
for(const [src,dest] of [['tone/build/Tone.js','tone-15.1.22.js'],['tone/LICENSE.md','Tone-LICENSE.md'],['three/build/three.module.min.js','three/three.module.js'],['three/build/three.core.min.js','three/three.core.min.js'],['three/LICENSE','three/LICENSE']])await copyFile(`node_modules/${src}`,`apps/web/vendor/${dest}`);
console.log('Pinned Tone.js and Three.js copied to the self-hosted runtime.');
