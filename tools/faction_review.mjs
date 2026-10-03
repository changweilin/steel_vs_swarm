import path from 'node:path';
import { serve } from './mech_prompt_review.mjs';

const portArg = process.argv.indexOf('--port');
const port = portArg < 0 ? 0 : Number(process.argv[portArg + 1]);
const server = serve(port, {
  threeModule: process.env.THREE_MODULE || path.resolve('out/forest_review/three.module.js'),
  pageFile: path.resolve('tools/mech_authoring/faction_review.html'),
  extraFiles: { '/faction_review.js': 'tools/mech_authoring/faction_review.js' },
});
server.once('listening', () => console.log(`Faction Studio: http://127.0.0.1:${server.address().port}/`));
